/** Unread counter: reducer + middleware. */

import roomsReducer, {
  addRoom,
  addRoomMessage,
  setCurrentRoom,
  setLastViewedTimestamp,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
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

function makeMsg(id: string, dateIso: string, body = 'hello'): IMessage {
  return {
    id,
    user: { id: 'u', name: 'user', token: '', refreshToken: '' } as any,
    date: dateIso,
    body,
    roomJid: 'r@h',
  };
}

function makeStore() {
  return configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) =>
      g({ serializableCheck: false }).concat(unreadMiddleware),
  });
}

describe('unread counter — reducer', () => {
  it('setLastViewedTimestamp(0) clears unread to 0 (entering room)', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [makeMsg('1', '2026-05-15T10:00:00Z')],
          unreadMessages: 5,
          lastViewedTimestamp: 1700000000000,
        }),
      })
    );
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: 0 })
    );
    const room = store.getState().rooms.rooms['r@h'];
    expect(room.unreadMessages).toBe(0);
    expect(room.lastViewedTimestamp).toBe(0);
  });

  it('setLastViewedTimestamp(now) counts strictly newer msgs by date', () => {
    const store = makeStore();
    // Messages dated +/- around the cutoff:
    const cutoff = Date.parse('2026-05-15T12:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [
            makeMsg('a', '2026-05-15T11:00:00Z'), // older — should NOT count
            makeMsg('b', '2026-05-15T12:00:00Z'), // == cutoff — strict > → not count
            makeMsg('c', '2026-05-15T13:00:00Z'), // newer — count
            makeMsg('d', '2026-05-15T14:00:00Z'), // newer — count
          ],
        }),
      })
    );
    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: cutoff })
    );
    const room = store.getState().rooms.rooms['r@h'];
    expect(room.unreadMessages).toBe(2);
    expect(room.lastViewedTimestamp).toBe(cutoff);
  });

  it('ignores delimiter-new and pending messages', () => {
    const store = makeStore();
    const cutoff = Date.parse('2026-05-15T12:00:00Z');
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [
            makeMsg('c', '2026-05-15T13:00:00Z'),
            { ...makeMsg('p', '2026-05-15T14:00:00Z'), pending: true },
            { ...makeMsg('x', '2026-05-15T15:00:00Z'), id: 'delimiter-new' },
          ],
        }),
      })
    );
    // sanity: confirm we put 3 messages on the room (debug only)
    const stored = store.getState().rooms.rooms['r@h'].messages;
    expect(stored).toHaveLength(3);
    expect(stored[1].pending).toBe(true);
    expect(stored[2].id).toBe('delimiter-new');

    store.dispatch(
      setLastViewedTimestamp({ chatJID: 'r@h', timestamp: cutoff })
    );
    const room = store.getState().rooms.rooms['r@h'];
    expect(room.unreadMessages).toBe(1);
  });
});

describe('unread counter — middleware (incremental)', () => {
  it('does not increment for active room', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'r@h' }));
    store.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: makeMsg('new', '2026-05-15T14:00:00Z'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['r@h'].unreadMessages).toBe(0);
  });

  it('increments unread for non-active room with non-zero lastViewedTimestamp', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', {
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        }),
      })
    );
    store.dispatch(
      addRoom({
        roomData: makeRoom('b@h', {
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'a@h' }));

    store.dispatch(
      addRoomMessage({
        roomJID: 'b@h',
        message: makeMsg('m1', '2026-05-15T11:00:00Z'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['b@h'].unreadMessages).toBe(1);

    store.dispatch(
      addRoomMessage({
        roomJID: 'b@h',
        message: makeMsg('m2', '2026-05-15T12:00:00Z'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['b@h'].unreadMessages).toBe(2);
  });

  it('recomputes when lastViewedTimestamp changes without a new message', () => {
    // Catches a regression where the per-room cache only tracked the
    // message count — a stale count would suppress recomputation when
    // the user re-opened a room (timestamp changed, count didn't).
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('a@h', {
          lastViewedTimestamp: Date.parse('2026-05-15T08:00:00Z'),
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'other@h' }));
    // Two unread relative to 08:00.
    store.dispatch(
      addRoomMessage({
        roomJID: 'a@h',
        message: makeMsg('m1', '2026-05-15T10:00:00Z'),
        start: true,
      })
    );
    store.dispatch(
      addRoomMessage({
        roomJID: 'a@h',
        message: makeMsg('m2', '2026-05-15T11:00:00Z'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['a@h'].unreadMessages).toBe(2);

    // Bump lastViewedTimestamp so only m2 is "newer" — count must
    // recompute even though messages.length didn't change.
    store.dispatch(
      setLastViewedTimestamp({
        chatJID: 'a@h',
        timestamp: Date.parse('2026-05-15T10:30:00Z'),
      })
    );
    expect(store.getState().rooms.rooms['a@h'].unreadMessages).toBe(1);
  });

  it('chat/logout clears the per-room suppression cache', () => {
    // After logout, a fresh login with the same JID + a single new
    // message must produce unread=1 — not be suppressed by the
    // previous session's cached fingerprint.
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        }),
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'other@h' }));
    store.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: makeMsg('m1', '2026-05-15T11:00:00Z'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['r@h'].unreadMessages).toBe(1);

    // Simulate logout → re-create the same fingerprint and verify
    // the middleware doesn't short-circuit.
    store.dispatch({ type: 'chat/logout' });
    const store2 = makeStore();
    store2.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        }),
      })
    );
    store2.dispatch(setCurrentRoom({ roomJID: 'other@h' }));
    store2.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: makeMsg('m1', '2026-05-15T11:00:00Z'),
        start: true,
      })
    );
    expect(store2.getState().rooms.rooms['r@h'].unreadMessages).toBe(1);
  });
});
