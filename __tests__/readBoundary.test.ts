/**
 * Regression tests for customer-reported #33 — "scroll up, receive new
 * messages without scrolling back down, leave the room: the unread count
 * is cleared and does NOT come back after an app restart."
 *
 * "Does not come back after a restart" is the tell: the wrong marker was
 * written to the SERVER-side private store, so rehydration re-applies it.
 * Several paths mark a room read (ChatRoom unmount, AppState background,
 * the `isVisible` consumer signal, the visible-room auto-advance,
 * useChatRoomFocus, logout) and each must stamp the boundary the user
 * actually reached rather than `Date.now()`.
 */
import reducer, {
  addRoom,
  setReadBoundary,
} from '../src/roomStore/roomsSlice';
import { flushLastViewedToPrivateStore } from '../src/networking/xmpp/flushLastViewedToPrivateStore';

jest.mock('../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp', () => ({
  getChatsPrivateStoreRequest: jest.fn(async () => ({})),
}));
jest.mock('../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp', () => ({
  setChatsPrivateStoreRequest: jest.fn(async () => undefined),
}));
const { setChatsPrivateStoreRequest } =
  require('../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp');

const room = (jid: string, extra: any = {}) => ({
  id: jid, name: jid, jid, title: jid, usersCnt: 0, messages: [],
  isLoading: false, roomBg: '', lastViewedTimestamp: 0, unreadMessages: 0,
  ...extra,
});

describe('readBoundaryTs reducer (#33)', () => {
  it('stores and clears the boundary for a room', () => {
    let s = reducer(undefined, addRoom({ roomData: room('a@h') as any }));
    s = reducer(s, setReadBoundary({ chatJID: 'a@h', boundaryTs: 1234 }));
    expect(s.rooms['a@h'].readBoundaryTs).toBe(1234);

    // Back at the bottom → everything on screen is read again.
    s = reducer(s, setReadBoundary({ chatJID: 'a@h', boundaryTs: null }));
    expect(s.rooms['a@h'].readBoundaryTs).toBeNull();
  });

  it('does not touch unreadMessages or lastViewedTimestamp', () => {
    let s = reducer(
      undefined,
      addRoom({ roomData: room('a@h', { unreadMessages: 7, lastViewedTimestamp: 999 }) as any })
    );
    s = reducer(s, setReadBoundary({ chatJID: 'a@h', boundaryTs: 5 }));
    expect(s.rooms['a@h'].unreadMessages).toBe(7);
    expect(s.rooms['a@h'].lastViewedTimestamp).toBe(999);
  });

  it('ignores unknown rooms', () => {
    const s = reducer(undefined, setReadBoundary({ chatJID: 'nope@h', boundaryTs: 1 }));
    expect(s.rooms['nope@h']).toBeUndefined();
  });
});

describe('flushLastViewedToPrivateStore honours the boundary (#33)', () => {
  const client = { client: {} } as any;
  beforeEach(() => (setChatsPrivateStoreRequest as jest.Mock).mockClear());

  const written = () =>
    JSON.parse((setChatsPrivateStoreRequest as jest.Mock).mock.calls[0][1]);

  it('writes the read boundary for the visible room, NOT now()', async () => {
    const BOUNDARY = 1_700_000_000_000;
    await flushLastViewedToPrivateStore(
      client,
      { 'a@h': { jid: 'a@h', unreadMessages: 3 } },
      { visibleRoomJID: 'a@h', visibleRoomTs: BOUNDARY }
    );
    expect(written()['a@h']).toBe(String(BOUNDARY));
  });

  it('falls back to now() when the user is at the bottom (boundary null)', async () => {
    const before = Date.now();
    await flushLastViewedToPrivateStore(
      client,
      { 'a@h': { jid: 'a@h', unreadMessages: 0 } },
      { visibleRoomJID: 'a@h', visibleRoomTs: null }
    );
    const ts = Number(written()['a@h']);
    expect(ts).toBeGreaterThanOrEqual(before);
  });

  it('ignores a non-positive boundary and uses now()', async () => {
    const before = Date.now();
    await flushLastViewedToPrivateStore(
      client,
      { 'a@h': { jid: 'a@h' } },
      { visibleRoomJID: 'a@h', visibleRoomTs: 0 }
    );
    expect(Number(written()['a@h'])).toBeGreaterThanOrEqual(before);
  });
});
