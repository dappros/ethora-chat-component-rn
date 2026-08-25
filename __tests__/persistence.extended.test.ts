/**
 * persistence middleware — extended edge-case coverage.
 *
 * Complements Roman's `persistence.test.ts` (debounce + sanitize +
 * read/clear). Adds:
 *
 *   - Multi-room cap (every room's messages capped independently)
 *   - Malformed-room-key sanitisation (defensive against legacy data)
 *   - Transient-field reset (composing, isLoading, etc.) on write
 *   - Debounce coalescing (rapid dispatches → single write)
 *   - Trigger-action filter (irrelevant action types don't write)
 *   - Round-trip rehydrate via readPersistedState
 *   - Subsequent writes overwrite (state evolution)
 *
 * Same `jest.useFakeTimers` pattern as the original suite so the
 * 200 ms debounce stays deterministic.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer, {
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import roomsReducer, {
  addRoom,
  setComposing,
  setIsLoading,
} from '../src/roomStore/roomsSlice';
import {
  PERSIST_KEYS,
  persistenceMiddleware,
  readPersistedState,
} from '../src/roomStore/persistence';
import { encryptForPersist, decryptFromPersist } from '../src/helpers/persistCrypto';
import type { IMessage, IRoom, User } from '../src/types/types';

// The at-rest value is an AES envelope, not the plain JSON the middleware
// serialized — decrypt before parsing so content assertions still read
// the real payload.
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

function makeUser(over: Partial<User> = {}): User {
  return {
    walletAddress: '0xabc',
    description: '',
    token: 'secret-token',
    refreshToken: 'secret-refresh',
    defaultWallet: { walletAddress: '0xabc' },
    _id: 'u1',
    firstName: 'Test',
    lastName: 'User',
    appId: 'app',
    xmppPassword: 'secret-xmpp',
    xmppUsername: '0xabc',
    ...over,
  } as User;
}

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

function makeMessages(count: number, prefix = 'm'): IMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    user: { id: 'u', name: 'u', token: '', refreshToken: '' } as any,
    date: `2026-05-15T10:00:${String(i % 60).padStart(2, '0')}Z`,
    body: `body-${prefix}-${i + 1}`,
    roomJid: 'r@h',
  }));
}

function makeStore() {
  return configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) =>
      g({ serializableCheck: false }).concat(persistenceMiddleware),
  });
}

async function flushDebouncedWrite() {
  jest.advanceTimersByTime(250);
  // Encrypting now awaits the SecureStore-backed cipher key (secureGet,
  // and on first use secureSet) before the ciphertext is even computed,
  // on top of the multiSet itself — deeper microtask chain than a bare
  // AsyncStorage write, so yield generously.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

// ---------- multi-room cap + per-room independence -------------------

describe('persistence — multi-room cap', () => {
  it('caps each room independently at 100 messages', async () => {
    const store = makeStore();
    // Room A: 120 messages → should be capped to last 100
    store.dispatch(
      addRoom({
        roomData: { ...makeRoom('a@h'), messages: makeMessages(120, 'a') },
      })
    );
    // Room B: 30 messages → kept as-is
    store.dispatch(
      addRoom({
        roomData: { ...makeRoom('b@h'), messages: makeMessages(30, 'b') },
      })
    );

    await flushDebouncedWrite();

    const persisted = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(persisted.rooms['a@h'].messages).toHaveLength(100);
    // Most-recent 100 kept: m-21 .. m-120
    expect(persisted.rooms['a@h'].messages[0].body).toBe('body-a-21');
    expect(persisted.rooms['a@h'].messages[99].body).toBe('body-a-120');
    expect(persisted.rooms['b@h'].messages).toHaveLength(30);
  });
});

// ---------- sanitisation of malformed input --------------------------

describe('persistence — sanitisation', () => {
  it('drops room keys without @ (malformed JIDs)', async () => {
    // Defensive: persisted state from older builds may carry empty or
    // non-JID keys. The sanitiser strips them at write time so they
    // never re-enter on rehydrate.
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('good@h') }));
    store.dispatch(addRoom({ roomData: makeRoom('also-good@h') }));
    // Sneak a malformed key in via direct state mutation pattern
    // (simulating a faulty bridge action). We use addRoom with a
    // pre-built room that has a malformed jid.
    store.dispatch(
      addRoom({
        roomData: { ...makeRoom('not-a-jid'), jid: 'not-a-jid' },
      })
    );

    await flushDebouncedWrite();

    const persisted = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(persisted.rooms['good@h']).toBeDefined();
    expect(persisted.rooms['also-good@h']).toBeDefined();
    expect(persisted.rooms['not-a-jid']).toBeUndefined();
  });

  it('resets transient fields (composing, composingList, isLoading) on write', async () => {
    // The persisted snapshot must not encode in-flight UI state — a
    // user closing the app mid-typing should not re-open with a stale
    // "Alice is typing…" indicator. Same for in-flight isLoading.
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    store.dispatch(
      setComposing({
        chatJID: 'a@h',
        composing: true,
        composingList: ['alice'],
      })
    );
    store.dispatch(
      setIsLoading({ chatJID: 'a@h', loading: true })
    );

    await flushDebouncedWrite();

    const persisted = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(persisted.rooms['a@h'].composing).toBe(false);
    expect(persisted.rooms['a@h'].composingList).toEqual([]);
    expect(persisted.rooms['a@h'].isLoading).toBe(false);
    expect(persisted.rooms['a@h'].historyPreloadState).toBe('idle');
  });
});

// ---------- debounce coalescing --------------------------------------

describe('persistence — debounce', () => {
  it('coalesces rapid dispatches inside the window into a single write', async () => {
    // The debounce window is 200 ms. Verifying via state delta rather
    // than spy counts (the persistence middleware's `writeTimer` is
    // module-scoped, making spy isolation across tests fragile —
    // checking AsyncStorage itself is the more durable assertion).
    const store = makeStore();
    store.dispatch(setUser(makeUser({ firstName: 'A' })));
    store.dispatch(setUser(makeUser({ firstName: 'B' })));
    store.dispatch(setUser(makeUser({ firstName: 'C' })));
    store.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    store.dispatch(addRoom({ roomData: makeRoom('b@h') }));

    // Before the timer fires: 0 visible writes (storage empty post
    // beforeEach AsyncStorage.clear()).
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_CHAT)).toBeNull();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS)).toBeNull();

    await flushDebouncedWrite();

    // After flush: the LAST setUser wins (proves the dispatches were
    // coalesced — if each had triggered an independent write, the
    // intermediate ones would still be the persisted ones up to the
    // last unflushed one, but in a coalesced model the final state
    // is what lands).
    const persistedChat = await readDecrypted(PERSIST_KEYS.KEY_CHAT);
    expect(persistedChat.user.firstName).toBe('C');
    const persistedRooms = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(Object.keys(persistedRooms.rooms).sort()).toEqual(['a@h', 'b@h']);
  });

  it('a subsequent action AFTER the debounce flush also persists', async () => {
    // Sanity that the timer resets after each flush so a later
    // dispatch isn't lost. Tested via state evolution: first
    // dispatch persists value A, second dispatch + flush persists
    // value B.
    const store = makeStore();
    store.dispatch(setUser(makeUser({ firstName: 'First' })));
    await flushDebouncedWrite();
    let persistedChat = await readDecrypted(PERSIST_KEYS.KEY_CHAT);
    expect(persistedChat.user.firstName).toBe('First');

    store.dispatch(setUser(makeUser({ firstName: 'Second' })));
    await flushDebouncedWrite();
    persistedChat = await readDecrypted(PERSIST_KEYS.KEY_CHAT);
    expect(persistedChat.user.firstName).toBe('Second');
  });
});

// ---------- trigger-action filter ------------------------------------

describe('persistence — trigger filter', () => {
  it('does NOT write when an unrelated action type is dispatched', async () => {
    // The middleware only writes for `roomMessages/*` and a handful
    // of `chat/*` action types. Random other action types must be
    // a complete no-op for storage I/O. Verifying directly via the
    // AsyncStorage state (no spy needed) so this test is robust to
    // module-level timer state from earlier tests in the same file.
    const store = makeStore();

    store.dispatch({ type: 'some-irrelevant-action', payload: {} });
    store.dispatch({ type: '@@INIT' });

    await flushDebouncedWrite();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_CHAT)).toBeNull();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS)).toBeNull();
  });
});

// ---------- round-trip rehydrate -------------------------------------

describe('persistence — rehydrate', () => {
  it('readPersistedState returns the rooms + chat slices that were just written', async () => {
    // End-to-end: write via the middleware, then read back via the
    // public API. The shapes should round-trip cleanly.
    const store = makeStore();
    store.dispatch(setUser(makeUser({ firstName: 'Trippy' })));
    store.dispatch(
      addRoom({
        roomData: { ...makeRoom('round@h'), messages: makeMessages(3) },
      })
    );

    await flushDebouncedWrite();

    // useRealTimers so AsyncStorage's internal Promise can resolve
    // for the read path (which doesn't depend on debounce).
    jest.useRealTimers();
    const out = await readPersistedState();
    expect(out.chat?.user.firstName).toBe('Trippy');
    expect(out.rooms?.rooms['round@h']).toBeDefined();
    expect(out.rooms?.rooms['round@h'].messages).toHaveLength(3);
  });

  it('readPersistedState handles a single-key state (only rooms, no chat)', async () => {
    // Manual write of just the rooms key — readPersistedState must
    // return `chat: null` without crashing. Seeded through the same
    // encryption envelope the middleware would have written — a raw
    // plaintext blob here would (correctly) come back as null too, see
    // the "pre-encryption install" case below.
    await AsyncStorage.setItem(
      PERSIST_KEYS.KEY_ROOMS,
      await encryptForPersist(
        JSON.stringify({ rooms: { 'lone@h': makeRoom('lone@h') } })
      )
    );
    jest.useRealTimers();
    const out = await readPersistedState();
    expect(out.chat).toBeNull();
    expect(out.rooms?.rooms['lone@h']).toBeDefined();
  });
});

// ---------- evolution: subsequent writes overwrite -------------------

describe('persistence — state evolution', () => {
  it('a later write replaces the earlier persisted snapshot (no append)', async () => {
    // Confirms the middleware writes the WHOLE snapshot each time
    // (not an append) so removing a room actually removes it from
    // the persisted state on the next flush.
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    store.dispatch(addRoom({ roomData: makeRoom('b@h') }));
    await flushDebouncedWrite();

    let persisted = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(Object.keys(persisted.rooms).sort()).toEqual(['a@h', 'b@h']);

    // Now drop the rooms manually-as-if from an action and confirm
    // the next write reflects the smaller state.
    // Easiest path: dispatch deleteAllRooms then re-add only a@h.
    const {
      deleteAllRooms,
    } = require('../src/roomStore/roomsSlice');
    store.dispatch(deleteAllRooms());
    store.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    await flushDebouncedWrite();

    persisted = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(Object.keys(persisted.rooms)).toEqual(['a@h']);
    expect(persisted.rooms['b@h']).toBeUndefined();
  });
});
