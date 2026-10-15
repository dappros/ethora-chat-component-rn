/**
 * Reducers for XEP-0184 delivery (setReceivedReceipt) and XEP-0333 read
 * watermarks (setDisplayedMarker). Both keys become property names, so the
 * unsafe-key guards (isSafeKey) are part of the contract.
 */
import roomsReducer, {
  addRoom,
  deleteAllRooms,
  setDisplayedMarker,
  setReceivedReceipt,
  setRoomMessages,
  setJumpWindow,
} from '../src/roomStore/roomsSlice';
import { configureStore } from '@reduxjs/toolkit';
import type { IMessage, IRoom } from '../src/types/types';

const ROOM = 'room1@conference.example.com';
const ME = 'me_user';

const msg = (id: string, from = 'them'): IMessage =>
  ({
    id,
    body: `body ${id}`,
    date: new Date(1700000000000 + Number(id.slice(-3) || 0)).toISOString(),
    roomJid: ROOM,
    user: { id: from, name: from },
  } as unknown as IMessage);

const makeStore = (messages: IMessage[] = [msg('1700000000001'), msg('1700000000002', ME)]) => {
  const store = configureStore({ reducer: { rooms: roomsReducer } });
  store.dispatch(deleteAllRooms());
  store.dispatch(
    addRoom({
      roomData: { jid: ROOM, name: ROOM, title: ROOM, messages: [] } as unknown as IRoom,
    })
  );
  store.dispatch(setRoomMessages({ roomJID: ROOM, messages }));
  return store;
};

const room = (store: ReturnType<typeof makeStore>) => store.getState().rooms.rooms[ROOM];
const messageById = (store: ReturnType<typeof makeStore>, id: string) =>
  room(store).messages.find((m) => m.id === id) as IMessage;

afterEach(() => {
  // Guard the prototype stays clean even if a reducer regresses.
  expect(({} as any).evil).toBeUndefined();
  expect(({} as any).polluted).toBeUndefined();
});

describe('setReceivedReceipt', () => {
  it('records the acknowledging user and time on the matching message only', () => {
    const store = makeStore();
    store.dispatch(
      setReceivedReceipt({
        roomJID: ROOM,
        messageId: '1700000000002',
        fromXmppUsername: 'them',
        timestamp: 1700000005000,
      })
    );
    expect(messageById(store, '1700000000002').receivedBy).toEqual({ them: 1700000005000 });
    expect(messageById(store, '1700000000001').receivedBy).toBeUndefined();
  });

  it('keeps every acknowledging user, and a repeat from the same user replaces the time', () => {
    const store = makeStore();
    const base = { roomJID: ROOM, messageId: '1700000000002' };
    store.dispatch(setReceivedReceipt({ ...base, fromXmppUsername: 'a', timestamp: 1 }));
    store.dispatch(setReceivedReceipt({ ...base, fromXmppUsername: 'b', timestamp: 2 }));
    store.dispatch(setReceivedReceipt({ ...base, fromXmppUsername: 'a', timestamp: 3 }));
    expect(messageById(store, '1700000000002').receivedBy).toEqual({ a: 3, b: 2 });
  });

  it('ignores an unknown room and an unknown message id', () => {
    const store = makeStore();
    const before = store.getState().rooms.rooms;
    store.dispatch(
      setReceivedReceipt({
        roomJID: 'nowhere@conference.example.com',
        messageId: '1700000000002',
        fromXmppUsername: 'them',
        timestamp: 1,
      })
    );
    store.dispatch(
      setReceivedReceipt({ roomJID: ROOM, messageId: 'missing', fromXmppUsername: 'them', timestamp: 1 })
    );
    expect(store.getState().rooms.rooms).toBe(before);
    expect(room(store).messages.every((m) => !m.receivedBy)).toBe(true);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'drops an unsafe sender key %s without writing anywhere',
    (unsafe) => {
      const store = makeStore();
      const before = store.getState().rooms.rooms;
      store.dispatch(
        setReceivedReceipt({
          roomJID: ROOM,
          messageId: '1700000000002',
          fromXmppUsername: unsafe,
          timestamp: 1,
        })
      );
      expect(store.getState().rooms.rooms).toBe(before);
      expect(messageById(store, '1700000000002').receivedBy).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    }
  );

  it.each(['__proto__', 'constructor', 'prototype'])(
    'drops an unsafe room key %s',
    (unsafe) => {
      const store = makeStore();
      const before = store.getState().rooms.rooms;
      store.dispatch(
        setReceivedReceipt({ roomJID: unsafe, messageId: '1700000000002', fromXmppUsername: 'them', timestamp: 1 })
      );
      expect(store.getState().rooms.rooms).toBe(before);
    }
  );

  it('also marks the copy held by an open jump window', () => {
    const store = makeStore();
    const window = [msg('1700000000002', ME)];
    store.dispatch(
      setJumpWindow({
        roomJID: ROOM,
        targetId: '1700000000002',
        messages: window,
      } as any)
    );
    store.dispatch(
      setReceivedReceipt({ roomJID: ROOM, messageId: '1700000000002', fromXmppUsername: 'them', timestamp: 9 })
    );
    const inWindow = store.getState().rooms.jumpWindow?.messages.find((m) => m.id === '1700000000002');
    expect(inWindow?.receivedBy).toEqual({ them: 9 });
  });
});

describe('setDisplayedMarker', () => {
  it('stores one watermark per user and replaces it on the next marker', () => {
    const store = makeStore();
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: 'them', messageId: '1700000000001' }));
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: 'them', messageId: '1700000000002' }));
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: 'third', messageId: '1700000000001' }));
    expect(room(store).lastDisplayedByUser).toEqual({
      them: '1700000000002',
      third: '1700000000001',
    });
  });

  it('does not touch the messages or the unread state', () => {
    const store = makeStore();
    const messagesBefore = room(store).messages;
    const unreadBefore = room(store).unreadMessages;
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: 'them', messageId: '1700000000002' }));
    expect(room(store).messages).toBe(messagesBefore);
    expect(room(store).unreadMessages).toBe(unreadBefore);
  });

  it('ignores an unknown room and an empty message id', () => {
    const store = makeStore();
    const before = store.getState().rooms.rooms;
    store.dispatch(setDisplayedMarker({ roomJID: 'nowhere@x', xmppUsername: 'them', messageId: 'a' }));
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: 'them', messageId: '' }));
    expect(store.getState().rooms.rooms).toBe(before);
    expect(room(store).lastDisplayedByUser).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'drops an unsafe user key %s without polluting the watermark map',
    (unsafe) => {
      const store = makeStore();
      store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: unsafe, messageId: 'x' }));
      const watermark = room(store).lastDisplayedByUser ?? {};
      expect(Object.prototype.hasOwnProperty.call(watermark, unsafe)).toBe(false);
      expect(({} as any).polluted).toBeUndefined();
    }
  );

  it('drops an unsafe room key', () => {
    const store = makeStore();
    const before = store.getState().rooms.rooms;
    store.dispatch(setDisplayedMarker({ roomJID: '__proto__', xmppUsername: 'them', messageId: 'x' }));
    expect(store.getState().rooms.rooms).toBe(before);
  });
});

