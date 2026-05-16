/**
 * Middleware trio — L1 store-level tests.
 *
 * Covers the three small store middlewares that ship alongside the
 * roomsSlice / chatSettingsSlice reducers:
 *
 *   - logoutMiddleware     — emits the `ethora-xmpp-logout`
 *                            DeviceEventEmitter signal on
 *                            `chatSettingStore/logout`.
 *   - newMessageMidlleware — bumps a room's `lastMessageTimestamp`
 *                            when a stanza-id newer than the current
 *                            stamp arrives via `addRoomMessage`.
 *   - reactionsMiddleware  — re-derives `lastMessage` /
 *                            `lastMessageTimestamp` from a reactions
 *                            update so the room-list preview reflects
 *                            "X reacted 🎉" without an extra fetch.
 *
 * Each test stands up a tiny configureStore with just the relevant
 * reducer + middleware so we don't drag in the whole store wiring.
 */

import { configureStore } from '@reduxjs/toolkit';
import { DeviceEventEmitter } from 'react-native';

import roomsReducer, {
  addRoom,
  addRoomMessage,
  setReactions,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer, {
  logout,
} from '../src/roomStore/chatSettingsSlice';
import { logoutMiddleware } from '../src/roomStore/Middleware/logoutMiddleware';
import { newMessageMidlleware } from '../src/roomStore/Middleware/newMessageMidlleware';
import { reactionsMiddleware } from '../src/roomStore/Middleware/reactionsMiddleware';
import type { IMessage, IRoom } from '../src/types/types';

// jest.setup.js doesn't stub DeviceEventEmitter — react-native's stub
// in jest-expo gives us a real one. Lazy-create a per-test spy inside
// the logoutMiddleware describe block (module-level spies on RN
// re-export objects don't always patch the live reference depending
// on the metro/jest resolver order, so we use a fresh spy per test).
let emitSpy: jest.SpyInstance;

afterEach(() => {
  jest.useRealTimers();
  emitSpy?.mockRestore?.();
});

function makeRoom(jid: string, overrides: Partial<IRoom> = {}): IRoom {
  return {
    id: jid,
    name: 'room',
    jid,
    title: 'room',
    usersCnt: 0,
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
  overrides: Partial<IMessage> = {}
): IMessage {
  return {
    id,
    user: { id: 'sender', name: 'sender', token: '', refreshToken: '' } as any,
    date: new Date(1735689600000).toISOString(), // 2025-01-01
    body: `body-${id}`,
    roomJid: 'r@h',
    ...overrides,
  };
}

// ---------- logoutMiddleware -----------------------------------------

describe('logoutMiddleware', () => {
  function makeStore() {
    return configureStore({
      reducer: { chatSettingStore: chatSettingsReducer },
      middleware: (g) =>
        g({ serializableCheck: false }).concat(logoutMiddleware),
    });
  }

  it('emits ethora-xmpp-logout on `chat/logout`', async () => {
    emitSpy = jest.spyOn(DeviceEventEmitter, 'emit');
    const store = makeStore();
    store.dispatch(logout());
    // Emitter is fired from a 0-delay setTimeout — let the macrotask
    // flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(emitSpy).toHaveBeenCalledWith('ethora-xmpp-logout');
  });

  it('does NOT emit ethora-xmpp-logout for unrelated actions', async () => {
    emitSpy = jest.spyOn(DeviceEventEmitter, 'emit');
    const store = makeStore();
    store.dispatch({ type: 'something/else' });
    await new Promise((r) => setTimeout(r, 5));
    expect(emitSpy).not.toHaveBeenCalledWith('ethora-xmpp-logout');
  });
});

// ---------- newMessageMidlleware -------------------------------------

describe('newMessageMidlleware', () => {
  function makeStore() {
    return configureStore({
      reducer: { rooms: roomsReducer },
      middleware: (g) =>
        g({ serializableCheck: false }).concat(newMessageMidlleware),
    });
  }

  it('bumps lastMessageTimestamp when an incoming message id beats the existing stamp', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', { lastMessageTimestamp: 100 }),
      })
    );
    store.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: makeMsg('500'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['r@h'].lastMessageTimestamp).toBe(
      500
    );
  });

  it('does NOT bump lastMessageTimestamp when the incoming id is older', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', { lastMessageTimestamp: 1000 }),
      })
    );
    store.dispatch(
      addRoomMessage({
        roomJID: 'r@h',
        message: makeMsg('500'),
        start: true,
      })
    );
    expect(store.getState().rooms.rooms['r@h'].lastMessageTimestamp).toBe(
      1000
    );
  });

  it('ignores actions other than addRoomMessage', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', { lastMessageTimestamp: 100 }),
      })
    );
    // Just any non-targeted action — the middleware should be a pass-through.
    store.dispatch({ type: 'unrelated/noop' });
    expect(store.getState().rooms.rooms['r@h'].lastMessageTimestamp).toBe(
      100
    );
  });

  it('is a no-op when the target room does not exist (no throw)', () => {
    const store = makeStore();
    expect(() =>
      store.dispatch(
        addRoomMessage({
          roomJID: 'missing@h',
          message: makeMsg('999'),
          start: true,
        })
      )
    ).not.toThrow();
  });

  it('does not blow up on malformed action shape', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore();
    // Manually dispatch a payload-less addRoomMessage. The reducer
    // expects a payload, so this still throws inside the reducer — but
    // the middleware's payload guard runs before that, so we assert
    // the *middleware* logged the issue.
    try {
      store.dispatch({ type: 'roomMessages/addRoomMessage' } as any);
    } catch {/* reducer-side error is expected */}
    expect(errSpy).toHaveBeenCalledWith(
      'Invalid action payload for addRoomMessage:',
      expect.any(Object)
    );
    errSpy.mockRestore();
  });
});

// ---------- reactionsMiddleware --------------------------------------

describe('reactionsMiddleware', () => {
  function makeStore() {
    return configureStore({
      reducer: { rooms: roomsReducer },
      middleware: (g) =>
        g({ serializableCheck: false }).concat(reactionsMiddleware),
    });
  }

  it('updates lastMessage to the reaction summary when a newer reaction arrives', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [makeMsg('1000000000000')],
          lastMessageTimestamp: 1000,
        }),
      })
    );
    store.dispatch(
      setReactions({
        roomJID: 'r@h',
        messageId: '1000000000000',
        reactions: ['🎉'],
        latestReactionTimestamp: '9999999999999',
        data: { senderFirstName: 'Alice', senderLastName: 'A' } as any,
      })
    );
    const room = store.getState().rooms.rooms['r@h'];
    // nanoToMs takes first 13 chars → 9999999999999 itself
    expect(room.lastMessageTimestamp).toBe(9999999999999);
    expect((room.lastMessage as any)?.emoji).toBe('🎉');
    expect((room.lastMessage as any)?.body).toBe('🎉');
    expect((room.lastMessage as any)?.user?.name).toBe('Alice A');
  });

  it('rolls lastMessage back to the previous real message when reactions are cleared', () => {
    const store = makeStore();
    const lastReal = makeMsg('1234567890123', { body: 'real body' });
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [makeMsg('1000000000000'), lastReal],
          lastMessageTimestamp: 1000,
        }),
      })
    );
    store.dispatch(
      setReactions({
        roomJID: 'r@h',
        messageId: '1234567890123',
        reactions: [], // cleared
        latestReactionTimestamp: '9999999999999',
        data: {} as any,
      })
    );
    const room = store.getState().rooms.rooms['r@h'];
    // The setReactions reducer stamps `reactions: []` onto the row before
    // the middleware runs, so the rolled-back row carries that field —
    // assert on the body + id rather than full equality.
    expect(room.lastMessage?.id).toBe('1234567890123');
    expect(room.lastMessage?.body).toBe('real body');
    expect(room.lastMessageTimestamp).toBe(1234567890123);
  });

  it('does NOT bump lastMessageTimestamp when the reaction is older than current', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', {
          messages: [makeMsg('9999999999999')],
          lastMessageTimestamp: 9999999999999,
        }),
      })
    );
    store.dispatch(
      setReactions({
        roomJID: 'r@h',
        messageId: '9999999999999',
        reactions: ['👍'],
        latestReactionTimestamp: '1000000000000',
        data: { senderFirstName: 'X', senderLastName: 'Y' } as any,
      })
    );
    expect(
      store.getState().rooms.rooms['r@h'].lastMessageTimestamp
    ).toBe(9999999999999);
  });

  it('warns and does nothing when the target room is missing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore();
    store.dispatch(
      setReactions({
        roomJID: 'missing@h',
        messageId: '1',
        reactions: ['🎉'],
        latestReactionTimestamp: '9999999999999',
        data: {} as any,
      })
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Room missing@h not found')
    );
    warn.mockRestore();
  });

  it('is a pass-through for non-setReactions actions', () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: makeRoom('r@h', { lastMessageTimestamp: 1000 }),
      })
    );
    store.dispatch({ type: 'unrelated/noop' });
    expect(store.getState().rooms.rooms['r@h'].lastMessageTimestamp).toBe(
      1000
    );
  });

  it('skips with a console.error for a malformed payload', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore();
    // Dispatch a setReactions action whose payload is a string (invalid).
    store.dispatch({
      type: 'roomMessages/setReactions',
      payload: 'oops',
    } as any);
    expect(errSpy).toHaveBeenCalledWith(
      'Invalid action payload for setReactions:',
      expect.any(Object)
    );
    errSpy.mockRestore();
  });
});
