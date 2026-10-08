/**
 * Join state is tied to the connection it was made on (connectionEpoch):
 * a join in flight when the socket dropped must not write failure/blocked
 * state into the new connection nor mark rooms joined, and the bounded retry
 * of rooms a sweep left unjoined is cancelled by a disconnect.
 */
const fakeClients: any[] = [];

jest.mock('@xmpp/client', () => {
  const xml = jest.fn();
  const client = jest.fn(() => {
    const listeners: Record<string, Array<(arg: any) => void>> = {};
    const inst: any = {
      status: 'offline',
      jid: { toString: () => 'me@example.com/res', getLocal: () => 'me' },
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, fn: (arg: any) => void) => {
        (listeners[event] = listeners[event] || []).push(fn);
      }),
      removeListener: jest.fn(),
      off: jest.fn(),
      send: jest.fn().mockResolvedValue(undefined),
      triggerEvent: (name: string, payload?: any) => {
        (listeners[name] || []).forEach((fn) => fn(payload));
      },
    };
    fakeClients.push(inst);
    return inst;
  });
  return { __esModule: true, default: { client, xml }, client, xml };
});

const mockPresenceInRoom = jest.fn();
jest.mock('../src/networking/xmpp/presenceInRoom.xmpp', () => ({
  presenceInRoom: (...a: unknown[]) => mockPresenceInRoom(...a),
}));
jest.mock('../src/networking/xmpp/handleStanzas.xmpp', () => ({
  handleStanza: jest.fn(),
}));

import { store } from '../src/roomStore';
import XmppClient from '../src/networking/xmppClient';
import { clearOutboundSends } from '../src/networking/outboundQueue';

const ROOM = 'a@conference.example.com';
const ROOM2 = 'b@conference.example.com';
const emit = (event: string) =>
  fakeClients[fakeClients.length - 1].triggerEvent(event);

const stubStore = (jids: string[], activeRoomJID = '') =>
  jest.spyOn(store, 'getState').mockReturnValue({
    rooms: {
      rooms: Object.fromEntries(jids.map((j) => [j, { jid: j, messages: [] }])),
      activeRoomJID,
    },
    chatSettingStore: {},
  } as any);

const emptySummary = {
  total: 0,
  success: 0,
  failed: 0,
  failedRooms: [],
  sweptRooms: [],
};

const make = () => {
  const client = new XmppClient('u', 'p', { devServer: 'h' }) as any;
  // Online without firing the 'online' event (that would start a sweep).
  client.status = 'online';
  client.suppressReconnect = true;
  return client;
};

beforeEach(() => {
  fakeClients.length = 0;
  mockPresenceInRoom.mockReset();
  clearOutboundSends();
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('stale join after a reconnect', () => {
  it('a join that times out after the socket dropped writes no backoff for the new connection', async () => {
    stubStore([ROOM]);
    const client = make();
    let fail!: (e: Error) => void;
    mockPresenceInRoom.mockReturnValue(new Promise((_, rej) => (fail = rej)));
    const stale = client.joins.ensureRoomPresence(ROOM, { timeoutMs: 5000 });
    emit('disconnect');
    fail(new Error('presence_timeout:' + ROOM));
    expect(await stale).toBe(false);
    expect(client.joins.roomPresenceBlockedUntil.has(ROOM)).toBe(false);
    expect(client.joins.joinedRooms.has(ROOM)).toBe(false);
  });

  it('a stale success does not mark the room joined on the new connection', async () => {
    stubStore([ROOM]);
    const client = make();
    let ok!: () => void;
    mockPresenceInRoom.mockReturnValue(new Promise<void>((res) => (ok = res)));
    const stale = client.joins.ensureRoomPresence(ROOM, { timeoutMs: 5000 });
    emit('disconnect');
    ok();
    expect(await stale).toBe(false);
    expect(client.joins.joinedRooms.has(ROOM)).toBe(false);
  });

  it('a stale join finishing does not drop the new connection in-flight entry', async () => {
    stubStore([ROOM]);
    const client = make();
    let fail!: (e: Error) => void;
    mockPresenceInRoom.mockReturnValueOnce(
      new Promise((_, rej) => (fail = rej))
    );
    const stale = client.joins.ensureRoomPresence(ROOM, { timeoutMs: 5000 });
    emit('disconnect');
    client.status = 'online';
    mockPresenceInRoom.mockReturnValueOnce(new Promise(() => {}));
    client.joins.ensureRoomPresence(ROOM, { timeoutMs: 5000 }).catch(() => undefined);
    expect(client.joins.roomPresenceInFlight.has(ROOM)).toBe(true);
    fail(new Error('presence_timeout'));
    await stale;
    expect(client.joins.roomPresenceInFlight.has(ROOM)).toBe(true);
  });

  it('a fresh failure on the current connection still backs off', async () => {
    stubStore([ROOM]);
    const client = make();
    mockPresenceInRoom.mockRejectedValue(new Error('presence_timeout'));
    expect(await client.joins.ensureRoomPresence(ROOM, { timeoutMs: 5000 })).toBe(
      false
    );
    expect(client.joins.roomPresenceBlockedUntil.get(ROOM)).toBeGreaterThan(
      Date.now()
    );
  });

  it('disconnect clears blocked-until together with joinedRooms and bumps the epoch', async () => {
    stubStore([ROOM]);
    const client = make();
    const before = client.connectionEpoch;
    client.joins.joinedRooms.add(ROOM2);
    client.joins.roomPresenceBlockedUntil.set(ROOM, Date.now() + 10000);
    emit('disconnect');
    expect(client.joins.joinedRooms.size).toBe(0);
    expect(client.joins.roomPresenceBlockedUntil.size).toBe(0);
    expect(client.connectionEpoch).toBe(before + 1);
    expect(client.presencesReady).toBe(false);
    expect(client.priorityPresencesReady).toBe(false);
  });

  it('a joined room is not joined twice and the join asks for the configured history size', async () => {
    stubStore([ROOM]);
    const client = new XmppClient('u', 'p', {
      devServer: 'h',
      historyQoS: { joinHistoryStanzas: 7 },
    }) as any;
    client.status = 'online';
    client.suppressReconnect = true;
    mockPresenceInRoom.mockResolvedValue(undefined);
    expect(await client.presenceInRoomStanza(ROOM)).toBe(true);
    expect(await client.presenceInRoomStanza(ROOM)).toBe(true);
    expect(mockPresenceInRoom).toHaveBeenCalledTimes(1);
    expect(mockPresenceInRoom.mock.calls[0].slice(1)).toEqual([ROOM, 0, 2000, 7]);
  });

  it('a send joins its own room first, written before the message', async () => {
    stubStore([ROOM]);
    const client = make();
    mockPresenceInRoom.mockResolvedValue(undefined);
    const order: string[] = [];
    mockPresenceInRoom.mockImplementation(async () => {
      order.push('join');
    });
    jest
      .spyOn(client.client, 'send')
      .mockImplementation((async () => {
        order.push('stanza');
      }) as any);
    client.sendMediaMessageStanza(ROOM, { a: 1 }, 'm1');
    // The join was written before the message went out.
    expect(order[0]).toBe('join');
  });
});

describe('background sweep readiness flags', () => {
  it('priorityPresencesReady is set by the first wave, before the sweep ends', async () => {
    const jids = Array.from({ length: 10 }, (_, i) => `r${i}@conference.example.com`);
    stubStore(jids);
    const client = make();
    mockPresenceInRoom.mockResolvedValue(undefined);
    const sweep = client.sendAllPresencesAndMarkReady();
    await jest.advanceTimersByTimeAsync(1);
    expect(client.priorityPresencesReady).toBe(true);
    expect(client.presencesReady).toBe(false);
    await jest.runAllTimersAsync();
    await sweep;
    expect(client.presencesReady).toBe(true);
    expect(client.joins.joinedRooms.size).toBe(10);
  });

  it('a sweep that outlives its connection marks nothing ready or joined', async () => {
    stubStore([ROOM, ROOM2]);
    const client = make();
    let release!: () => void;
    mockPresenceInRoom.mockReturnValue(
      new Promise<void>((res) => (release = res))
    );
    const sweep = client.sendAllPresencesAndMarkReady();
    await jest.advanceTimersByTimeAsync(1);
    emit('disconnect');
    release();
    await jest.runAllTimersAsync();
    await sweep;
    expect(client.presencesReady).toBe(false);
    expect(client.priorityPresencesReady).toBe(false);
    expect(client.joins.joinedRooms.size).toBe(0);
  });
});

describe('sweep retries rooms left unjoined', () => {
  it('retries after the block expires and joins the room', async () => {
    stubStore([ROOM]);
    const client = make();
    client.joins.roomPresenceBlockedUntil.set(ROOM, Date.now() + 10000);
    const spy = jest
      .spyOn(client.joins, 'allRoomPresencesStanza')
      .mockResolvedValueOnce({
        total: 1,
        success: 0,
        failed: 1,
        failedRooms: [ROOM],
        sweptRooms: [ROOM],
      } as any)
      .mockResolvedValueOnce({
        total: 1,
        success: 1,
        failed: 0,
        failedRooms: [],
        sweptRooms: [ROOM],
      } as any);
    await client.sendAllPresencesAndMarkReady();
    expect(spy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(9000);
    expect(spy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(client.joins.joinedRooms.has(ROOM)).toBe(true);
    // Nothing left: no more rounds.
    await jest.advanceTimersByTimeAsync(60000);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('is bounded to three rounds', async () => {
    stubStore([ROOM]);
    const client = make();
    const spy = jest
      .spyOn(client.joins, 'allRoomPresencesStanza')
      .mockResolvedValue({
        total: 1,
        success: 0,
        failed: 1,
        failedRooms: [ROOM],
        sweptRooms: [ROOM],
      } as any);
    await client.sendAllPresencesAndMarkReady();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(1 + 3);
  });

  it('does not retry rooms under a long (hard) block', async () => {
    stubStore([ROOM]);
    const client = make();
    client.joins.roomPresenceBlockedUntil.set(ROOM, Date.now() + 60 * 60 * 1000);
    const spy = jest
      .spyOn(client.joins, 'allRoomPresencesStanza')
      .mockResolvedValue(emptySummary as any);
    await client.sendAllPresencesAndMarkReady();
    await jest.advanceTimersByTimeAsync(60000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a disconnect cancels the pending retry', async () => {
    stubStore([ROOM]);
    const client = make();
    const spy = jest
      .spyOn(client.joins, 'allRoomPresencesStanza')
      .mockResolvedValue({
        total: 1,
        success: 0,
        failed: 1,
        failedRooms: [ROOM],
        sweptRooms: [ROOM],
      } as any);
    await client.sendAllPresencesAndMarkReady();
    expect(client.joins.sweepRetryTimer).not.toBeNull();
    emit('disconnect');
    expect(client.joins.sweepRetryTimer).toBeNull();
    await jest.advanceTimersByTimeAsync(60000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
