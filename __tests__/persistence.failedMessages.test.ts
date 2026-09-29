/**
 * persistence -- failedMessages persistence + boot-time pending->failed
 * conversion (bug #39: "Failed sends show as sent after a relaunch").
 *
 * Companion to persistence.test.ts / persistence.extended.test.ts. Covers
 * the two pieces added for bug #39:
 *
 *   - `roomHeapStore.failedMessages` now persists (its own KEY_HEAP key,
 *     sanitized media payloads, and the debounced write now also
 *     triggers on `roomHeapStore/*` actions, not just `roomMessages/*`).
 *   - `reconstructFailedMessagePayload` / `computeBootTimeFailures`: the
 *     pure functions roomStore/index.ts's `persistorReady` uses to turn
 *     a message that was still `pending: true` when the app died into a
 *     retry-able failed entry, instead of it silently rendering as sent.
 *
 * Root cause being guarded against: optimistic messages lived in
 * `rooms[jid].messages` (persisted) while pending/failed state lived
 * only in `roomHeapSlice` (NOT persisted). A relaunch rehydrated the
 * message body with no memory of it ever having failed, so the bubble
 * rendered a normal "sent" tick.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import roomsReducer, {
  addRoom,
  addRoomMessage,
} from '../src/roomStore/roomsSlice';
import {
  roomHeapSlice,
  markMessageFailed,
  clearMessageFailure,
} from '../src/roomStore/roomHeapSlice';
import {
  PERSIST_KEYS,
  MAX_PERSISTED_FAILED_MESSAGES,
  persistenceMiddleware,
  readPersistedState,
  clearPersistedState,
  reconstructFailedMessagePayload,
  computeBootTimeFailures,
} from '../src/roomStore/persistence';
import { decryptFromPersist, encryptForPersist } from '../src/helpers/persistCrypto';
import type { IMessage, IRoom } from '../src/types/types';
import type { FailedMessagePayload } from '../src/roomStore/roomHeapSlice';

// The at-rest value is an AES envelope, not the plain JSON the middleware
// serialized -- decrypt before parsing so content assertions read the
// real payload (same helper as persistence.test.ts).
async function readDecrypted(key: string): Promise<any> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {return null;}
  const plain = await decryptFromPersist(raw);
  return plain ? JSON.parse(plain) : null;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function makeRoom(jid: string, overrides: Partial<IRoom> = {}): IRoom {
  return {
    id: jid,
    name: 'r',
    jid,
    title: 'r',
    usersCnt: 1,
    messages: [],
    isLoading: false,
    roomBg: '',
    ...overrides,
  };
}

function makeStore() {
  return configureStore({
    reducer: { rooms: roomsReducer, roomHeapSlice: roomHeapSlice.reducer },
    middleware: (g) =>
      g({ serializableCheck: false }).concat(persistenceMiddleware),
  });
}

async function flushDebouncedWrite() {
  jest.advanceTimersByTime(250);
  // Encrypting awaits the SecureStore-backed cipher key on top of the
  // AsyncStorage write itself -- yield generously (mirrors
  // persistence.extended.test.ts's flushDebouncedWrite).
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------
// persistence write/read of failedMessages
// ---------------------------------------------------------------------

describe('persistence -- failedMessages write + read', () => {
  it('persists a markMessageFailed entry to KEY_HEAP', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    store.dispatch(
      markMessageFailed({
        kind: 'text',
        id: 'm1',
        roomJID: 'r@h',
        body: 'hi',
        isReply: false,
        isChecked: false,
        mainMessage: '',
      })
    );

    // Debounced -- no write yet.
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_HEAP)).toBeNull();

    await flushDebouncedWrite();

    const persisted = await readDecrypted(PERSIST_KEYS.KEY_HEAP);
    expect(persisted.failedMessages.m1).toEqual(
      expect.objectContaining({
        kind: 'text',
        id: 'm1',
        roomJID: 'r@h',
        body: 'hi',
      })
    );
  });

  it('strips unexpected fields off a media payload before writing', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    store.dispatch(
      markMessageFailed({
        kind: 'media',
        id: 'm2',
        roomJID: 'r@h',
        type: 'image/jpeg',
        data: {
          uri: 'file:///tmp/pic.jpg',
          name: 'pic.jpg',
          size: 1024,
          // The picker never actually hands us these, but the sanitizer
          // must strip anything beyond uri/type/name/size regardless --
          // defense in depth against a future picker change, or a huge
          // inline blob, sneaking into `data`.
          base64: 'A'.repeat(5000),
          authToken: 'secret-token',
        } as any,
      })
    );

    await flushDebouncedWrite();

    const persisted = await readDecrypted(PERSIST_KEYS.KEY_HEAP);
    const stored = persisted.failedMessages.m2;
    expect(stored.data).toEqual({
      uri: 'file:///tmp/pic.jpg',
      name: 'pic.jpg',
      size: 1024,
    });
    expect(stored.data.base64).toBeUndefined();
    expect(stored.data.authToken).toBeUndefined();
  });

  it('clearMessageFailure removes the entry from the next write', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    store.dispatch(
      markMessageFailed({ kind: 'text', id: 'm1', roomJID: 'r@h', body: 'hi' })
    );
    await flushDebouncedWrite();
    let persisted = await readDecrypted(PERSIST_KEYS.KEY_HEAP);
    expect(persisted.failedMessages.m1).toBeDefined();

    store.dispatch(clearMessageFailure('m1'));
    await flushDebouncedWrite();
    persisted = await readDecrypted(PERSIST_KEYS.KEY_HEAP);
    expect(persisted.failedMessages.m1).toBeUndefined();
  });

  it('caps the persisted map at MAX_PERSISTED_FAILED_MESSAGES', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    for (let i = 0; i < MAX_PERSISTED_FAILED_MESSAGES + 20; i++) {
      store.dispatch(
        markMessageFailed({
          kind: 'text',
          id: `m${i}`,
          roomJID: 'r@h',
          body: `b${i}`,
        })
      );
    }
    await flushDebouncedWrite();
    const persisted = await readDecrypted(PERSIST_KEYS.KEY_HEAP);
    expect(Object.keys(persisted.failedMessages)).toHaveLength(
      MAX_PERSISTED_FAILED_MESSAGES
    );
  });

  it('round-trips through readPersistedState', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    store.dispatch(
      markMessageFailed({
        kind: 'text',
        id: 'm1',
        roomJID: 'r@h',
        body: 'hi',
        isReply: true,
        mainMessage: 'root-1',
      })
    );
    await flushDebouncedWrite();

    jest.useRealTimers();
    const out = await readPersistedState();
    expect(out.heap?.failedMessages.m1).toEqual(
      expect.objectContaining({
        kind: 'text',
        id: 'm1',
        roomJID: 'r@h',
        body: 'hi',
        isReply: true,
        mainMessage: 'root-1',
      })
    );
  });

  it('a roomHeapStore-only action (no rooms/chat change) still triggers a write', async () => {
    // Regression guard for the persistenceMiddleware trigger-type filter:
    // markMessageFailed's action type is `roomHeapStore/markMessageFailed`,
    // which must be in the allow-list alongside `roomMessages/*` and
    // `chat/*`, or a failure that happens with no other store activity
    // would silently never reach disk.
    const store = makeStore();
    store.dispatch(
      markMessageFailed({ kind: 'text', id: 'lone', roomJID: 'r@h', body: 'x' })
    );
    await flushDebouncedWrite();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_HEAP)).not.toBeNull();
  });

  it('clearPersistedState removes KEY_HEAP alongside the other keys', async () => {
    await AsyncStorage.setItem(
      PERSIST_KEYS.KEY_HEAP,
      await encryptForPersist(JSON.stringify({ failedMessages: { m1: {} } }))
    );
    await clearPersistedState();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_HEAP)).toBeNull();
  });
});

// ---------------------------------------------------------------------
// reconstructFailedMessagePayload
// ---------------------------------------------------------------------

describe('reconstructFailedMessagePayload', () => {
  it('reconstructs a text payload from a persisted pending message', () => {
    const message = {
      id: 'send-text-message-1',
      body: 'hello',
      roomJid: 'r@h',
      date: '2026-06-01T10:00:00Z',
      pending: true,
      isReply: true,
      showInChannel: 'true',
      mainMessage: 'root-9',
    } as IMessage;

    expect(reconstructFailedMessagePayload(message, 'r@h')).toEqual({
      kind: 'text',
      id: 'send-text-message-1',
      roomJID: 'r@h',
      body: 'hello',
      isReply: true,
      isChecked: true,
      mainMessage: 'root-9',
    });
  });

  it('reconstructs a media payload from a persisted pending media message', () => {
    const message = {
      id: 'send-media-message:uuid-1',
      body: 'media',
      roomJid: 'r@h',
      date: '2026-06-01T10:00:00Z',
      pending: true,
      isMediafile: 'true',
      mimetype: 'image/png',
      fileName: 'shot.png',
      location: 'file:///cache/shot.png',
      size: '2048',
    } as IMessage;

    expect(reconstructFailedMessagePayload(message, 'r@h')).toEqual({
      kind: 'media',
      id: 'send-media-message:uuid-1',
      roomJID: 'r@h',
      data: {
        uri: 'file:///cache/shot.png',
        name: 'shot.png',
        type: 'image/png',
        size: 2048,
      },
      type: 'image/png',
      isReply: false,
      isChecked: false,
      mainMessage: undefined,
    });
  });

  it('returns null when the message has no id', () => {
    expect(reconstructFailedMessagePayload({} as IMessage, 'r@h')).toBeNull();
  });

  it('returns null when roomJID is missing', () => {
    expect(
      reconstructFailedMessagePayload({ id: 'm1' } as IMessage, '')
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------
// computeBootTimeFailures
// ---------------------------------------------------------------------

describe('computeBootTimeFailures', () => {
  it('flags a still-pending message and skips a delivered one', () => {
    const rooms: Record<string, IRoom> = {
      'r@h': {
        ...makeRoom('r@h'),
        messages: [
          { id: 'delivered-1', body: 'ok', roomJid: 'r@h', date: '', pending: false } as IMessage,
          { id: 'stuck-1', body: 'never sent', roomJid: 'r@h', date: '', pending: true } as IMessage,
        ],
      },
    };

    const result = computeBootTimeFailures(rooms, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'stuck-1',
        roomJID: 'r@h',
        kind: 'text',
        body: 'never sent',
      })
    );
  });

  it('skips a pending message that already has a restored failure entry', () => {
    const rooms: Record<string, IRoom> = {
      'r@h': {
        ...makeRoom('r@h'),
        messages: [
          { id: 'stuck-1', body: 'never sent', roomJid: 'r@h', date: '', pending: true } as IMessage,
        ],
      },
    };
    const alreadyFailed: Record<string, FailedMessagePayload> = {
      'stuck-1': { kind: 'text', id: 'stuck-1', roomJID: 'r@h', body: 'never sent' },
    };

    expect(computeBootTimeFailures(rooms, alreadyFailed)).toEqual([]);
  });

  it('scans across multiple rooms', () => {
    const rooms: Record<string, IRoom> = {
      'a@h': {
        ...makeRoom('a@h'),
        messages: [{ id: 'a-1', body: 'a', roomJid: 'a@h', date: '', pending: true } as IMessage],
      },
      'b@h': {
        ...makeRoom('b@h'),
        messages: [{ id: 'b-1', body: 'b', roomJid: 'b@h', date: '', pending: true } as IMessage],
      },
    };

    const result = computeBootTimeFailures(rooms, {});
    expect(result.map((p) => p.id).sort()).toEqual(['a-1', 'b-1']);
  });

  it('returns [] when there are no rooms', () => {
    expect(computeBootTimeFailures(undefined, {})).toEqual([]);
    expect(computeBootTimeFailures(null, {})).toEqual([]);
    expect(computeBootTimeFailures({}, {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// End-to-end: kill mid-send -> relaunch -> failed + retry-able
// (the actual bug #39 repro, minus the app process itself)
// ---------------------------------------------------------------------

describe('persistence -- boot rehydrate simulates a kill mid-send (bug #39)', () => {
  it('a message still pending when the app died comes back failed, not sent', async () => {
    // 1) "Live session": an optimistic send goes out (pending: true,
    //    mirrors useSendMessage's optimistic dispatch) and no server echo
    //    ever arrives before the process dies -- nothing clears `pending`.
    const liveStore = makeStore();
    liveStore.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    liveStore.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: {
          id: 'send-text-message-9',
          body: 'are you there',
          roomJid: 'r@h',
          date: '2026-06-01T10:00:00Z',
          pending: true,
          isReply: false,
          showInChannel: 'false',
          mainMessage: '',
          user: { id: 'u1', name: 'Alice' } as any,
        } as IMessage,
      })
    );
    await flushDebouncedWrite();

    // 2) "Relaunch": read back exactly what roomStore/index.ts's
    //    persistorReady would read on a fresh process.
    jest.useRealTimers();
    const persisted = await readPersistedState();
    expect(persisted.rooms?.rooms['r@h'].messages[0].pending).toBe(true);

    const restoredFailed = persisted.heap?.failedMessages || {};
    const bootFailures = computeBootTimeFailures(
      persisted.rooms?.rooms,
      restoredFailed
    );
    expect(bootFailures).toEqual([
      expect.objectContaining({
        kind: 'text',
        id: 'send-text-message-9',
        roomJID: 'r@h',
        body: 'are you there',
      }),
    ]);

    // 3) Replay the exact dispatch sequence persistorReady runs, against
    //    a fresh store standing in for the relaunched app.
    const bootStore = makeStore();
    for (const [, room] of Object.entries(persisted.rooms!.rooms)) {
      bootStore.dispatch(addRoom({ roomData: room as IRoom }));
    }
    for (const payload of bootFailures) {
      bootStore.dispatch(markMessageFailed(payload));
    }

    const state = bootStore.getState();
    // This is exactly what Message.tsx's `isFailed = failedIdSet.has(id)`
    // reads -- present here means the bubble renders "Failed / tap to
    // retry" instead of a normal sent tick.
    expect(state.roomHeapSlice.failedMessages['send-text-message-9']).toEqual(
      expect.objectContaining({
        kind: 'text',
        roomJID: 'r@h',
        body: 'are you there',
      })
    );
  });

  it('an already-failed message restores its persisted payload as-is (no duplicate reconstruction)', async () => {
    // The watchdog already marked this failed DURING the live session
    // (before the kill), so both the failedMessages map and the
    // underlying message's `pending: true` are on disk together --
    // exactly like the real runtime invariant (markMessageFailed never
    // touches the message's own `pending` field, see roomHeapSlice.ts).
    const liveStore = makeStore();
    liveStore.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    liveStore.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: {
          id: 'm-watchdog-failed',
          body: 'original body',
          roomJid: 'r@h',
          date: '2026-06-01T10:00:00Z',
          pending: true,
          user: { id: 'u1', name: 'Alice' } as any,
        } as IMessage,
      })
    );
    liveStore.dispatch(
      markMessageFailed({
        kind: 'text',
        id: 'm-watchdog-failed',
        roomJID: 'r@h',
        body: 'original body',
        isReply: false,
        isChecked: false,
        mainMessage: '',
      })
    );
    await flushDebouncedWrite();

    jest.useRealTimers();
    const persisted = await readPersistedState();
    const restoredFailed = persisted.heap?.failedMessages || {};
    expect(restoredFailed['m-watchdog-failed']).toBeDefined();

    // The boot-time scan must skip it (it's already covered) rather than
    // synthesizing a second, possibly-divergent payload for the same id.
    const bootFailures = computeBootTimeFailures(
      persisted.rooms?.rooms,
      restoredFailed
    );
    expect(bootFailures).toEqual([]);
  });
});
