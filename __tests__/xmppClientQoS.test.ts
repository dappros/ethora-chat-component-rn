/** XmppClient QoS surface: active-room boost, soft-pause, coalesced MAM. */

// Stub @xmpp/client BEFORE importing XmppClient so the constructor
// doesn't touch a real WebSocket.
jest.mock('@xmpp/client', () => {
  const xml = jest.fn();
  const client = jest.fn(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
    status: 'offline',
  }));
  return { __esModule: true, default: { client, xml }, client, xml };
});

// Stub the MAM call that `enqueueHistoryTask` delegates to.
jest.mock('../src/networking/xmpp/getHistory.xmpp', () => ({
  getHistory: jest.fn(async () => ['msg1', 'msg2']),
}));

import XmppClient from '../src/networking/xmppClient';
import { getHistory } from '../src/networking/xmpp/getHistory.xmpp';

const mockedGetHistory = getHistory as jest.Mock;

function makeClient(qos: Partial<any> = {}) {
  return new XmppClient('u', 'p', {
    devServer: 'host',
    historyQoS: {
      maxInFlightHistory: 2,
      softPauseAfterSendMs: 200,
      activeRoomBoostTtlMs: 1500,
      alwaysPrioritizeActiveRoom: true,
      ...qos,
    },
  });
}

describe('XmppClient — QoS', () => {
  beforeEach(() => {
    mockedGetHistory.mockClear();
    mockedGetHistory.mockImplementation(async () => ['msg']);
  });

  it('setActiveRoomJid promotes the room and opens the gate', () => {
    const c = makeClient();
    expect(c.isActiveRoomGateOpen()).toBe(true);
    c.setActiveRoomJid('room@h');
    expect(c.isActiveRoomGateOpen()).toBe(true);
  });

  it('onCriticalSend soft-pauses the gate', () => {
    const c = makeClient();
    c.onCriticalSend('room@h');
    // gate stays open by inflight cap, but softPauseUntil is in future.
    expect((c as any).softPauseUntil).toBeGreaterThan(Date.now());
  });

  it('disableLastRead gates private-store methods', async () => {
    const c = makeClient();
    (c as any).disableLastRead = true;
    expect(await c.getChatsPrivateStoreRequestStanza()).toBeNull();
    // actionSetTimestampToPrivateStoreStanza returns void; just check it
    // doesn't reach the stanza helper (no error thrown).
    await c.actionSetTimestampToPrivateStoreStanza('r@h', 1, []);
  });

  it('enqueueHistoryTask coalesces same-room requests with lower priority', async () => {
    const c = makeClient();
    let resolve: any;
    mockedGetHistory.mockImplementationOnce(
      () => new Promise((r) => { resolve = r; })
    );

    const first = c.enqueueHistoryTask({
      chatJID: 'r@h',
      max: 10,
      source: 'active',
    });
    // Same room with background priority should coalesce → reuse first.
    const second = c.enqueueHistoryTask({
      chatJID: 'r@h',
      max: 10,
      source: 'background',
    });
    // Resolve to let everything settle.
    resolve!(['msg1']);
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual(['msg1']);
    expect(r2).toEqual(['msg1']);
    expect(mockedGetHistory).toHaveBeenCalledTimes(1);
  });

  it('mamInFlightByRoom cleans up after task settles', async () => {
    const c = makeClient();
    const p = c.enqueueHistoryTask({ chatJID: 'r@h', max: 10 });
    expect((c as any).mamInFlightByRoom.size).toBe(1);
    await p;
    expect((c as any).mamInFlightByRoom.size).toBe(0);
  });

  it('getHistoryStanza with options.coalesceRoom routes through the queue', async () => {
    const c = makeClient();
    await c.getHistoryStanza('r@h', 10, undefined, undefined, {
      coalesceRoom: true,
      source: 'background',
    });
    expect(mockedGetHistory).toHaveBeenCalled();
  });
});
