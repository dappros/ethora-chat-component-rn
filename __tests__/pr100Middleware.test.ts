/**
 * Middleware and persistence behaviour ported from web PR #100: server unread
 * (`unreadCount`) seeding, jump while a thread is open, the reactions
 * preview, session reset on rehydrate.
 */
import { configureStore } from '@reduxjs/toolkit';
import roomsReducer, {
  addRoom,
  addRoomFromApi,
  addRoomMessage,
  requestJumpToMessage,
  setActiveMessage,
  setCurrentRoom,
  setLastViewedTimestamp,
  setReactions,
  setRoomMessages,
  setVisibleRoom,
} from '../src/roomStore/roomsSlice';
import { unreadMiddleware } from '../src/roomStore/Middleware/unreadMidlleware';
import { reactionsMiddleware } from '../src/roomStore/Middleware/reactionsMiddleware';
import { jumpThreadMiddleware } from '../src/roomStore/Middleware/jumpThreadMiddleware';
import { createRoomFromApi } from '../src/helpers/createRoomFromApi';
import {
  clearJumpThread,
  getJumpThread,
  JUMP_TTL_MS,
} from '../src/helpers/jumpThread';
import { resetSessionRoomState } from '../src/roomStore/persistence';

const SERVICE = 'conference.example.com';
const JID = `app_room1@${SERVICE}`;

const makeStore = () =>
  configureStore({
    reducer: { rooms: roomsReducer } as any,
    middleware: (gdm) =>
      gdm({ serializableCheck: false, immutableCheck: false })
        .concat(unreadMiddleware)
        .concat(reactionsMiddleware)
        .concat(jumpThreadMiddleware),
  });

describe('unread from /chats/my `unreadCount`', () => {
  let store: ReturnType<typeof makeStore>;
  const seed = (extra: Record<string, unknown> = {}) =>
    store.dispatch(
      addRoomFromApi({
        room: createRoomFromApi(
          { name: 'app_room1', type: 'group', title: 'Room 1', ...extra } as any,
          SERVICE
        ) as any,
      })
    );
  const msg = (id: string, ts: number, from = 'peer-1') =>
    ({
      id,
      body: `body ${id}`,
      date: new Date(ts).toISOString(),
      roomJid: JID,
      user: { id: from, name: from },
    }) as any;
  const room = () => (store.getState() as any).rooms.rooms[JID];

  beforeEach(() => {
    store = makeStore();
  });

  it('shows the API count straight away, with no history loaded', () => {
    seed({ unreadCount: 5 });
    expect(room().messages).toHaveLength(0);
    expect(room().unreadMessages).toBe(5);
  });

  it('changes nothing for a backend that sends no unreadCount', () => {
    seed();
    expect(room().apiUnreadCount).toBeUndefined();
    expect(room().unreadMessages).toBe(0);
  });

  it('does not double count when history later loads the messages the API already counted', () => {
    seed({ unreadCount: 3 });
    const old = Date.now() - 60_000;
    store.dispatch(
      setRoomMessages({
        roomJID: JID,
        messages: [msg('a', old), msg('b', old + 1000), msg('c', old + 2000)],
      })
    );
    expect(room().messages.length).toBe(3);
    expect(room().unreadMessages).toBe(3);
  });

  it('adds messages that arrive after the seed on top of the API number', () => {
    seed({ unreadCount: 3 });
    store.dispatch(addRoomMessage({ roomJID: JID, message: msg('live', Date.now() + 5) }));
    expect(room().unreadMessages).toBe(4);
  });

  it('does not count system messages on top', () => {
    seed({ unreadCount: 2 });
    store.dispatch(
      addRoomMessage({
        roomJID: JID,
        message: { ...msg('sys', Date.now() + 5), isSystemMessage: 'true' },
      })
    );
    expect(room().unreadMessages).toBe(2);
  });

  it('is not reset to 0 by an unrelated update', () => {
    seed({ unreadCount: 2 });
    store.dispatch(setLastViewedTimestamp({ chatJID: JID, timestamp: 0 }));
    expect(room().unreadMessages).toBe(2);
  });

  it('is ignored once the user has read past the API last message', () => {
    const lastAt = Date.now() - 10_000;
    seed({
      unreadCount: 4,
      lastMessage: { body: 'x', createdAt: new Date(lastAt).toISOString() },
    });
    expect(room().unreadMessages).toBe(4);
    store.dispatch(setLastViewedTimestamp({ chatJID: JID, timestamp: lastAt + 1000 }));
    expect(room().unreadMessages).toBe(0);
  });

  it('opening the room clears it for good (it does not come back on leave)', () => {
    seed({ unreadCount: 6 });
    store.dispatch(setCurrentRoom({ roomJID: JID }));
    expect(room().unreadMessages).toBe(0);
    expect(room().apiUnreadCount).toBeUndefined();
    store.dispatch(setCurrentRoom({ roomJID: null }));
    store.dispatch(setRoomMessages({ roomJID: JID, messages: [msg('z', Date.now() - 1000)] }));
    expect(room().unreadMessages).toBe(0);
  });

  it('a /chats/my refresh brings the fresh count; one without the field keeps the last', () => {
    seed({ unreadCount: 2 });
    seed({ unreadCount: 7 });
    expect(room().unreadMessages).toBe(7);
    seed();
    expect(room().apiUnreadCount).toBe(7);
    expect(room().unreadMessages).toBe(7);
  });

  it('a refresh while the room is open does not re-seed an unread badge', () => {
    seed({ unreadCount: 1 });
    store.dispatch(setCurrentRoom({ roomJID: JID }));
    seed({ unreadCount: 9 });
    expect(room().unreadMessages).toBe(0);
    expect(room().apiUnreadCount).toBeUndefined();
  });

  it('a refresh while the room is visible does not re-seed either', () => {
    seed({ unreadCount: 1 });
    store.dispatch(setVisibleRoom({ roomJID: JID }));
    seed({ unreadCount: 9 });
    expect(room().unreadMessages).toBe(0);
  });
});

describe('resetSessionRoomState (rehydrate)', () => {
  it("demotes a persisted 'done'/'loading'/'error' so the room is refetched once per session", () => {
    const out = resetSessionRoomState({
      a: { historyPreloadState: 'done', messages: [{ id: '1' }] },
      b: { historyPreloadState: 'done', messages: [] },
      c: { historyPreloadState: 'loading', messages: [{ id: '1' }] },
      d: { historyPreloadState: 'partial', messages: [] },
      e: { historyPreloadState: 'error', messages: [] },
      f: { historyPreloadState: 'error', messages: [{ id: '1' }] },
      g: { historyPreloadState: 'idle', apiUnreadCount: 4, apiUnreadSeededAt: 1 },
    } as never);
    expect(out.a.historyPreloadState).toBe('partial');
    expect(out.b.historyPreloadState).toBe('idle');
    expect(out.c.historyPreloadState).toBe('partial');
    expect(out.d.historyPreloadState).toBe('partial');
    expect(out.e.historyPreloadState).toBe('idle');
    expect(out.f.historyPreloadState).toBe('partial');
    expect(out.g.apiUnreadCount).toBeUndefined();
    expect(out.g.apiUnreadSeededAt).toBeUndefined();
  });
});

describe('reactionsMiddleware', () => {
  const R = 'rooma@conference.xmpp.example.com';
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
    store.dispatch(addRoom({ roomData: { jid: R, name: 'a', messages: [] } as any }));
  });
  const payload = (reactions: string[]) =>
    ({
      roomJID: R,
      messageId: 'x',
      from: 'peer@example.com',
      reactions,
      latestReactionTimestamp: '1700000000000000',
      data: { senderFirstName: 'A', senderLastName: 'B' },
    }) as any;

  it('does not throw when a reaction is removed in a room with no messages', () => {
    expect(() => store.dispatch(setReactions(payload([])))).not.toThrow();
  });

  it('a live reaction sets the preview, an archive replay does not', () => {
    store.dispatch({ ...setReactions(payload(['heart'])), meta: { fromHistory: true } });
    expect((store.getState() as any).rooms.rooms[R].lastMessage?.body).not.toBe('heart');
    store.dispatch(setReactions(payload(['heart'])));
    expect((store.getState() as any).rooms.rooms[R].lastMessage?.body).toBe('heart');
  });
});

describe('jump while a thread is open', () => {
  const ROOM = 'room@conference.example.com';
  const mk = (n: number, extra: Record<string, unknown> = {}) =>
    ({
      id: String(1_700_000_000_000_000 + n * 1000),
      body: `b${n}`,
      date: new Date(1_700_000_000_000 + n * 1000).toISOString(),
      roomJid: ROOM,
      user: { id: 'u' },
      ...extra,
    }) as any;
  const reply = (n: number, parent: any) =>
    mk(n, { isReply: 'true', mainMessage: JSON.stringify({ id: parent.id, roomJid: ROOM }) });
  const P1 = mk(1);
  const P2 = mk(2);
  const MAIN = mk(3);
  const R1 = reply(4, P1);
  const R2 = reply(5, P2);

  const setup = () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: { jid: ROOM, messages: [], title: 'r' } as any }));
    store.dispatch(setRoomMessages({ roomJID: ROOM, messages: [P1, P2, MAIN, R1, R2] }));
    store.dispatch(setActiveMessage({ id: P1.id, chatJID: ROOM }));
    return store;
  };
  const rooms = (store: any) => store.getState().rooms;
  const openId = (store: any) =>
    rooms(store).rooms[ROOM].messages.find((m: any) => m.activeMessage)?.id;
  const jumpTo = (m: any) => requestJumpToMessage({ roomJID: ROOM, ids: [m.id] });

  beforeEach(() => {
    jest.useFakeTimers();
    clearJumpThread();
  });
  afterEach(() => jest.useRealTimers());

  it('closes the thread for a main-list target and keeps the jump pending', () => {
    const store = setup();
    expect(openId(store)).toBe(P1.id);
    store.dispatch(jumpTo(MAIN));
    expect(openId(store)).toBeUndefined();
    expect(rooms(store).pendingJump?.ids).toEqual([MAIN.id]);
  });

  it('keeps the thread for a reply of the same parent', () => {
    const store = setup();
    store.dispatch(jumpTo(R1));
    expect(openId(store)).toBe(P1.id);
    expect(getJumpThread()?.parentId).toBe(P1.id);
    expect(getJumpThread()?.at).toBe(rooms(store).pendingJump?.at);
  });

  it('closes the thread for a reply of another parent so the main list resolves it', () => {
    const store = setup();
    store.dispatch(jumpTo(R2));
    expect(openId(store)).toBeUndefined();
    expect(rooms(store).pendingJump?.ids).toEqual([R2.id]);
  });

  it('does nothing to a closed state when no thread is open', () => {
    const store = setup();
    store.dispatch({ type: 'roomMessages/setCloseActiveMessage', payload: { chatJID: ROOM } });
    store.dispatch(jumpTo(MAIN));
    expect(rooms(store).pendingJump).toBeTruthy();
  });

  it('drops an unowned request after the TTL without the archived card when the message is live', () => {
    const store = setup();
    store.dispatch(jumpTo(MAIN));
    jest.advanceTimersByTime(JUMP_TTL_MS + 6000);
    expect(rooms(store).pendingJump).toBeNull();
    expect(rooms(store).archivedMessage ?? null).toBeNull();
  });

  it('shows the archived preview after the TTL only when the message is not live', () => {
    const store = setup();
    const preview = { roomJID: ROOM, sender: 's', body: 'old', createdAt: 'x' };
    store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['gone'], preview }));
    jest.advanceTimersByTime(JUMP_TTL_MS + 6000);
    expect(rooms(store).pendingJump).toBeNull();
    expect(rooms(store).archivedMessage).toBeTruthy();
  });

  it('opening a thread on a window-only parent records it for the panel', () => {
    const store = setup();
    store.dispatch({ type: 'roomMessages/setCloseActiveMessage', payload: { chatJID: ROOM } });
    const far = mk(50);
    const farReply = reply(51, far);
    store.dispatch({
      type: 'roomMessages/setJumpWindow',
      payload: {
        roomJID: ROOM,
        messages: [far, farReply],
        targetId: far.id,
        olderCursor: null,
        hasOlder: false,
        newerCursor: null,
        hasNewer: false,
      },
    });
    store.dispatch(setActiveMessage({ id: far.id, chatJID: ROOM }));
    expect(getJumpThread()?.parentId).toBe(far.id);
    expect(getJumpThread()?.parent?.id).toBe(far.id);
    expect(getJumpThread()?.replies.map((m) => m.id)).toEqual([farReply.id]);
    store.dispatch({ type: 'roomMessages/setCloseActiveMessage', payload: { chatJID: ROOM } });
    expect(getJumpThread()).toBeNull();
  });

  it('logout forgets the held thread', () => {
    setup();
    const store = makeStore();
    store.dispatch(addRoom({ roomData: { jid: ROOM, messages: [], title: 'r' } as any }));
    store.dispatch({
      type: 'roomMessages/setJumpWindow',
      payload: {
        roomJID: ROOM,
        messages: [mk(60)],
        targetId: mk(60).id,
        olderCursor: null,
        hasOlder: false,
        newerCursor: null,
        hasNewer: false,
      },
    });
    store.dispatch(setActiveMessage({ id: mk(60).id, chatJID: ROOM }));
    expect(getJumpThread()).not.toBeNull();
    store.dispatch({ type: 'chat/logout' });
    expect(getJumpThread()).toBeNull();
  });
});

afterAll(() => {
  // keep the shared module state tidy for other suites in this worker
  clearJumpThread();
});
