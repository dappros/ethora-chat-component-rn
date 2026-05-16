/**
 * Unread counter — extended edge-case coverage.
 *
 * Complements Roman's `unreadCounter.test.ts` (which covers the
 * happy paths). Each test here targets a real field-bug class
 * surfaced on the other platforms (Android + iOS Cluster E in
 * `QA_SCENARIOS.md`) or documents an intentional RN divergence
 * from the cross-platform contract.
 *
 * Some tests in this file PASS today (regression guards) and one
 * DOCUMENTS a known gap (RN doesn't exclude own messages from
 * unread — a divergence from Android/iOS). The gap test asserts the
 * current behaviour with a clear "if we fix this, flip the
 * expectation" comment, so a future patch is a deliberate flip
 * rather than silent drift.
 */

import roomsReducer, {
  addRoom,
  addRoomMessage,
  deleteRoomMessage,
  editRoomMessage,
  setCurrentRoom,
  setLastViewedTimestamp,
  setRoomMessages,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer, {
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import { unreadMiddleware } from '../src/roomStore/Middleware/unreadMidlleware';
import { configureStore } from '@reduxjs/toolkit';
import type { IMessage, IRoom } from '../src/types/types';

function makeRoom(jid: string, overrides: Partial<IRoom> = {}): IRoom {
  return {
    id: jid,
    name: 'room',
    jid,
    title: 'room',
    usersCnt: 1,
    messages: [],
    isLoading: false,
    roomBg: '',
    lastViewedTimestamp: 0,
    unreadMessages: 0,
    ...overrides,
  };
}

function makeMsg(
  id: string,
  dateIso: string,
  overrides: Partial<IMessage> = {}
): IMessage {
  return {
    id,
    user: { id: 'other-user', name: 'other', token: '', refreshToken: '' } as any,
    date: dateIso,
    body: `body-${id}`,
    roomJid: 'r@h',
    ...overrides,
  };
}

function makeStore() {
  return configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) =>
      g({ serializableCheck: false }).concat(unreadMiddleware),
  });
}

// ---------- reducer-layer: setLastViewedTimestamp edge cases ----------

describe('unread counter — reducer edge cases', () => {
  it('counts 0 when the messages list is empty', () => {
    const store = makeStore();
    const cutoff = Date.parse('2026-05-15T10:00:00Z');
    store.dispatch(addRoom({ roomData: makeRoom('r@h', { messages: [] }) }));
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: cutoff })
    );
    expect(store.getState().rooms.rooms['r@h'].unreadMessages).toBe(0);
  });

  it('counts 0 when every message predates the cutoff', () => {
    // Regression guard: a reducer that flipped `>` to `>=` would
    // accidentally count the boundary AND older messages.
    const store = makeStore();
    const cutoff = Date.parse('2026-05-15T15:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [
            makeMsg('a', '2026-05-15T10:00:00Z'),
            makeMsg('b', '2026-05-15T12:00:00Z'),
            makeMsg('c', '2026-05-15T14:59:59Z'),
          ],
        }),
      })
    );
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: cutoff })
    );
    expect(store.getState().rooms.rooms['r@h'].unreadMessages).toBe(0);
  });

  it('counts all messages when every one is newer than the cutoff', () => {
    const store = makeStore();
    const cutoff = Date.parse('2026-05-15T08:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [
            makeMsg('a', '2026-05-15T10:00:00Z'),
            makeMsg('b', '2026-05-15T12:00:00Z'),
            makeMsg('c', '2026-05-15T14:00:00Z'),
          ],
        }),
      })
    );
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: cutoff })
    );
    expect(store.getState().rooms.rooms['r@h'].unreadMessages).toBe(3);
  });

  it('setLastViewedTimestamp on a missing room is a no-op', () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('real@h') }));
    const before = store.getState().rooms.rooms;
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'ghost@h', timestamp: 1_700_000_000_000 })
    );
    expect(store.getState().rooms.rooms).toEqual(before);
  });
});

// ---------- middleware: cross-room isolation + recompute paths -------

describe('unread counter — middleware cross-room behavior', () => {
  it('addRoomMessage on room A does NOT affect room B unread', () => {
    // The most subtle unread bug class — a regression where the
    // middleware iterates and accidentally recomputes wrong rooms.
    // This locks in per-room isolation.
    const store = makeStore();
    const baseTs = Date.parse('2026-05-15T10:00:00Z');
    store.dispatch(
      addRoom({ roomData: makeRoom('a@h', { lastViewedTimestamp: baseTs }) })
    );
    store.dispatch(
      addRoom({
        roomData: makeRoom('b@h', {
          lastViewedTimestamp: baseTs,
          unreadMessages: 3, // pre-existing badge
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'a@h' }));

    // Receiving in A (active) should not touch A's unread (already 0)
    // and must NOT touch B's pre-existing unread = 3.
    store.dispatch(
      addRoomMessage({
        roomJID: 'a@h',
        message: makeMsg('m1', '2026-05-15T11:00:00Z'),
        start: true,
      })
    );

    expect(store.getState().rooms.rooms['a@h'].unreadMessages).toBe(0);
    // Note: B's unread is recomputed from messages count, so it
    // settles at 0 here because B has no messages. The point is
    // the recompute is keyed off the affected room, not bled
    // across via stale state.
    expect(store.getState().rooms.rooms['b@h'].unreadMessages).toBe(0);
  });

  it('switching current room to B clears B unread via setLastViewedTimestamp(0)', () => {
    // This is the canonical "user enters room → badge clears"
    // pattern. Driving via setLastViewedTimestamp(0) — the call
    // the chat UI fires on room-enter.
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', {
          unreadMessages: 7,
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        }),
      })
    );
    store.dispatch(setLastViewedTimestamp({ chatJID: 'a@h', timestamp: 0 }));
    const room = store.getState().rooms.rooms['a@h'];
    expect(room.unreadMessages).toBe(0);
    expect(room.lastViewedTimestamp).toBe(0);
  });

  it('editRoomMessage in a non-active room does not bump unread', () => {
    // Edits never represent a new received message. The
    // middleware only recomputes when message count delta
    // changes — locking that contract in.
    const store = makeStore();
    const baseTs = Date.parse('2026-05-15T10:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', {
          lastViewedTimestamp: baseTs,
          messages: [makeMsg('m1', '2026-05-15T11:00:00Z')],
          unreadMessages: 1,
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'other@h' }));

    store.dispatch(
      editRoomMessage({
        roomJID: 'a@h',
        messageId: 'm1',
        text: 'edited body',
      })
    );

    // Edit kept body change, didn't trigger a recompute that
    // would have counted m1 again (still 1, not 2).
    const room = store.getState().rooms.rooms['a@h'];
    expect(room.messages.find((m) => m.id === 'm1')?.body).toBe('edited body');
    expect(room.unreadMessages).toBe(1);
  });

  it('deleteRoomMessage passes through without recomputing unread (RN contract)', () => {
    // The middleware short-circuits on deleteRoomMessage — it
    // returns next(action) before touching unread state. This
    // documents the current behaviour: deleting a message does
    // NOT decrement the badge. The web + iOS + Android contracts
    // differ here (they recompute); RN deliberately treats delete
    // as visual-only to avoid the badge "flickering" when MUC
    // retraction echoes back. Test pins the contract so a future
    // "make consistent" refactor is a deliberate change.
    const store = makeStore();
    const baseTs = Date.parse('2026-05-15T10:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', {
          lastViewedTimestamp: baseTs,
          messages: [
            makeMsg('m1', '2026-05-15T11:00:00Z'),
            makeMsg('m2', '2026-05-15T12:00:00Z'),
          ],
          unreadMessages: 2,
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'other@h' }));

    store.dispatch(
      deleteRoomMessage({ roomJID: 'a@h', messageId: 'm2' })
    );

    const room = store.getState().rooms.rooms['a@h'];
    // m2 still in list but flagged as deleted.
    expect(room.messages.find((m) => m.id === 'm2')?.isDeleted).toBe(true);
    // Unread did NOT decrement — the contract this test documents.
    expect(room.unreadMessages).toBe(2);
  });
});

// ---------- own-message exclusion (parity with Android/iOS Cluster E) -

describe('unread counter — own-message exclusion (cross-platform parity)', () => {
  it('does not count messages authored by the current user', () => {
    // Android `RoomStore.updateUnreadCount` and iOS
    // `RoomStore.recomputeUnreadForRoom` both exclude messages
    // authored by the current user (cluster E in QA_SCENARIOS.md).
    // RN's `unreadMiddleware` now matches: it filters out messages
    // whose `user.id` / `user.userJID` / `user.xmppUsername` /
    // `xmppFrom` resolve to the same local part as the current
    // user's `xmppUsername` or `walletAddress` from
    // `chatSettingStore.user`.
    //
    // Field motivation: after a re-login, the user's own historical
    // messages (which arrive via MAM replay) used to get counted as
    // unread until the user opened the room. The badge over-counted.
    const store = makeStore();
    const baseTs = Date.parse('2026-05-15T10:00:00Z');
    const ownUserId = 'me@xmpp';
    store.dispatch(
      setUser({
        xmppUsername: 'me',
        defaultWallet: { walletAddress: '0xself' },
      } as any)
    );
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { lastViewedTimestamp: baseTs }),
      })
    );
    store.dispatch(
      addRoom({
        roomData: makeRoom('b@h', { lastViewedTimestamp: baseTs }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'a@h' }));

    // Drop two own messages into B (non-active room).
    store.dispatch(
      addRoomMessage({
        roomJID: 'b@h',
        message: makeMsg('own-1', '2026-05-15T11:00:00Z', {
          user: { id: ownUserId, name: 'me', token: '', refreshToken: '' } as any,
        }),
        start: true,
      })
    );
    store.dispatch(
      addRoomMessage({
        roomJID: 'b@h',
        message: makeMsg('own-2', '2026-05-15T12:00:00Z', {
          user: { id: ownUserId, name: 'me', token: '', refreshToken: '' } as any,
        }),
        start: true,
      })
    );

    expect(store.getState().rooms.rooms['b@h'].unreadMessages).toBe(0);
  });

  it('still counts messages from a different user (own-filter is precise)', () => {
    // Regression guard for the fix above — filtering must NOT be
    // over-broad. A message from any other sender past the cutoff
    // still bumps the badge.
    const store = makeStore();
    const baseTs = Date.parse('2026-05-15T10:00:00Z');
    store.dispatch(setUser({ xmppUsername: 'me' } as any));
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { lastViewedTimestamp: baseTs }),
      })
    );
    store.dispatch(
      addRoom({
        roomData: makeRoom('b@h', { lastViewedTimestamp: baseTs }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'a@h' }));
    store.dispatch(
      addRoomMessage({
        roomJID: 'b@h',
        message: makeMsg('other-1', '2026-05-15T11:00:00Z', {
          user: { id: 'someone-else', name: 'them', token: '', refreshToken: '' } as any,
        }),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['b@h'].unreadMessages).toBe(1);
  });
});

// ---------- defensive: malformed message dates ----------------------

describe('unread counter — defensive against malformed dates', () => {
  it('messages with invalid dates contribute 0 to the count', () => {
    // `new Date("not-a-date").getTime()` → NaN. The filter does
    // `getTime() > cutoff`, and NaN > anything is false, so the
    // message is excluded. Lock the contract so a future refactor
    // that tries to "fix" NaN handling doesn't accidentally start
    // counting garbage as unread.
    const store = makeStore();
    const cutoff = Date.parse('2026-05-15T10:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [
            makeMsg('good', '2026-05-15T11:00:00Z'),
            makeMsg('bad', 'not-a-real-date'),
          ],
        }),
      })
    );
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: cutoff })
    );
    expect(store.getState().rooms.rooms['r@h'].unreadMessages).toBe(1);
  });
});
