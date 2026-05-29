/**
 * Outbound-send queue — buffering + replay across an XMPP (re)connect.
 *
 * Covers the "No XMPP client" send race fix:
 *   - pure module: enqueue / FIFO flush / TTL drop / clear / dedupe
 *   - XmppClient integration: sendMessage + sendMediaMessageStanza buffer
 *     while the stream is down, then replay (in order) on the next
 *     'online' — and the buffer is cleared on close().
 */

// ---- @xmpp/client fake (mirrors xmppClientLifecycle.test.ts) ---------
interface FakeXmppClient {
  status: 'offline' | 'connecting' | 'online' | 'error';
  start: jest.Mock;
  stop: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  send: jest.Mock;
  _listeners: Record<string, Array<(arg: any) => void>>;
  triggerEvent: (name: string, payload?: any) => void;
}

const fakeClientInstances: FakeXmppClient[] = [];

jest.mock('@xmpp/client', () => {
  const xml = jest.fn();
  const client = jest.fn(() => {
    const listeners: Record<string, Array<(arg: any) => void>> = {};
    const inst: FakeXmppClient = {
      status: 'offline',
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, fn: (arg: any) => void) => {
        (listeners[event] = listeners[event] || []).push(fn);
      }),
      off: jest.fn(),
      send: jest.fn().mockResolvedValue(undefined),
      _listeners: listeners,
      triggerEvent: (name, payload) => {
        (listeners[name] || []).forEach((fn) => fn(payload));
      },
    };
    fakeClientInstances.push(inst);
    return inst;
  });
  return { __esModule: true, default: { client, xml }, client, xml };
});

// Stub the stanza helpers so we can assert what actually reached the wire.
jest.mock('../src/networking/xmpp/sendTextMessage.xmpp', () => ({
  sendTextMessage: jest.fn(),
}));
jest.mock('../src/networking/xmpp/sendMediaMessage.xmpp', () => ({
  sendMediaMessage: jest.fn(() => 'media-id'),
}));
jest.mock('../src/networking/xmpp/handleStanzas.xmpp', () => ({
  handleStanza: jest.fn(),
}));

import {
  enqueueOutboundSend,
  flushOutboundSends,
  clearOutboundSends,
  outboundQueueLength,
  OUTBOUND_QUEUE_TTL_MS,
  OutboundQueueClient,
} from '../src/networking/outboundQueue';
import XmppClient from '../src/networking/xmppClient';
import { sendTextMessage } from '../src/networking/xmpp/sendTextMessage.xmpp';
import { sendMediaMessage } from '../src/networking/xmpp/sendMediaMessage.xmpp';

const last = () => fakeClientInstances[fakeClientInstances.length - 1];

beforeEach(() => {
  fakeClientInstances.length = 0;
  jest.clearAllMocks();
  jest.useRealTimers();
  clearOutboundSends();
});

// ---- pure module ----------------------------------------------------

describe('outboundQueue — pure module', () => {
  const fakeClient = (): OutboundQueueClient & {
    calls: string[];
  } => {
    const calls: string[] = [];
    return {
      calls,
      sendMessage: (...a: any[]) => calls.push(`text:${a[5]}`),
      sendMediaMessageStanza: (...a: any[]) => calls.push(`media:${a[2]}`),
    };
  };

  it('flushes queued sends in FIFO order', () => {
    const c = fakeClient();
    const now = 1_000_000;
    enqueueOutboundSend({
      optimisticId: 'a',
      roomJID: 'r',
      enqueuedAt: now,
      send: (cl) => cl.sendMessage('r', '', '', '', '', 'first', '', false, false, '', 'a'),
    });
    enqueueOutboundSend({
      optimisticId: 'b',
      roomJID: 'r',
      enqueuedAt: now,
      send: (cl) => cl.sendMessage('r', '', '', '', '', 'second', '', false, false, '', 'b'),
    });
    expect(outboundQueueLength()).toBe(2);

    flushOutboundSends(c, now + 100);
    expect(c.calls).toEqual(['text:first', 'text:second']);
    // Queue is drained after flush.
    expect(outboundQueueLength()).toBe(0);
  });

  it('drops items older than the TTL and replays fresh ones', () => {
    const c = fakeClient();
    const now = 1_000_000;
    enqueueOutboundSend({
      optimisticId: 'stale',
      roomJID: 'r',
      enqueuedAt: now,
      send: (cl) => cl.sendMessage('r', '', '', '', '', 'stale', '', false, false, '', 'stale'),
    });
    enqueueOutboundSend({
      optimisticId: 'fresh',
      roomJID: 'r',
      enqueuedAt: now + OUTBOUND_QUEUE_TTL_MS, // newer
      send: (cl) => cl.sendMessage('r', '', '', '', '', 'fresh', '', false, false, '', 'fresh'),
    });

    // Flush at a moment where 'stale' is past TTL but 'fresh' is not.
    flushOutboundSends(c, now + OUTBOUND_QUEUE_TTL_MS + 1);
    expect(c.calls).toEqual(['text:fresh']);
  });

  it('dedupes a re-enqueue of the same id (keeps position, no duplicate)', () => {
    const c = fakeClient();
    const now = 1_000_000;
    enqueueOutboundSend({
      optimisticId: 'm1',
      roomJID: 'r',
      enqueuedAt: now,
      send: (cl) => cl.sendMediaMessageStanza('r', {}, 'm1'),
    });
    // Re-enqueue same id (e.g. media retry) — must not duplicate.
    enqueueOutboundSend({
      optimisticId: 'm1',
      roomJID: 'r',
      enqueuedAt: now,
      send: (cl) => cl.sendMediaMessageStanza('r', {}, 'm1'),
    });
    expect(outboundQueueLength()).toBe(1);
    flushOutboundSends(c, now + 1);
    expect(c.calls).toEqual(['media:m1']);
  });

  it('clearOutboundSends empties the queue', () => {
    enqueueOutboundSend({
      optimisticId: 'x',
      roomJID: 'r',
      enqueuedAt: 1,
      send: () => {},
    });
    expect(outboundQueueLength()).toBe(1);
    clearOutboundSends();
    expect(outboundQueueLength()).toBe(0);
  });

  it('a throwing replay does not strand the rest of the queue', () => {
    const calls: string[] = [];
    const c: OutboundQueueClient = {
      sendMessage: (...a: any[]) => {
        if (a[5] === 'boom') {throw new Error('replay failed');}
        calls.push(a[5]);
      },
      sendMediaMessageStanza: () => {},
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = 1;
    enqueueOutboundSend({ optimisticId: '1', roomJID: 'r', enqueuedAt: now, send: (cl) => cl.sendMessage('r', '', '', '', '', 'boom', '', false, false, '', '1') });
    enqueueOutboundSend({ optimisticId: '2', roomJID: 'r', enqueuedAt: now, send: (cl) => cl.sendMessage('r', '', '', '', '', 'ok', '', false, false, '', '2') });
    flushOutboundSends(c, now + 1);
    expect(calls).toEqual(['ok']);
    warn.mockRestore();
  });
});

// ---- XmppClient integration -----------------------------------------

describe('XmppClient — send buffering across reconnect', () => {
  it('buffers a text send while offline, then replays it on online', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    // status is 'connecting' (not online) → send should buffer, not forward.
    const delivered = c.sendMessage(
      'r@h', 'A', 'B', '', '0x', 'hi', '', false, false, '', 'opt-1'
    );
    expect(delivered).toBe(false);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(outboundQueueLength()).toBe(1);

    // Stream comes online → onOnline flushes the queue for real.
    last().triggerEvent('online');
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const args = (sendTextMessage as jest.Mock).mock.calls[0];
    expect(args[6]).toBe('hi'); // userMessage
    expect(args[12]).toBe('opt-1'); // customId
    expect(outboundQueueLength()).toBe(0);
  });

  it('preserves send order across the reconnect flush', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.sendMessage('r@h', '', '', '', '', 'one', '', false, false, '', 'id1');
    c.sendMessage('r@h', '', '', '', '', 'two', '', false, false, '', 'id2');
    c.sendMessage('r@h', '', '', '', '', 'three', '', false, false, '', 'id3');
    expect(outboundQueueLength()).toBe(3);

    last().triggerEvent('online');
    const bodies = (sendTextMessage as jest.Mock).mock.calls.map((call) => call[6]);
    expect(bodies).toEqual(['one', 'two', 'three']);
  });

  it('sends directly (no buffering) once online', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    last().triggerEvent('online');
    const delivered = c.sendMessage(
      'r@h', '', '', '', '', 'live', '', false, false, '', 'id-live'
    );
    expect(delivered).toBe(true);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(outboundQueueLength()).toBe(0);
  });

  it('buffers a media stanza while offline and replays on online', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const out = c.sendMediaMessageStanza('r@h', { foo: 'bar' }, 'media-1');
    expect(out).toBeUndefined();
    expect(sendMediaMessage).not.toHaveBeenCalled();
    expect(outboundQueueLength()).toBe(1);

    last().triggerEvent('online');
    expect(sendMediaMessage).toHaveBeenCalledTimes(1);
    const args = (sendMediaMessage as jest.Mock).mock.calls[0];
    expect(args[3]).toBe('media-1'); // customId
  });

  it('close() clears the buffered queue (permanent teardown)', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.sendMessage('r@h', '', '', '', '', 'lost', '', false, false, '', 'id-x');
    expect(outboundQueueLength()).toBe(1);
    await c.close();
    expect(outboundQueueLength()).toBe(0);
    // A subsequent online must NOT replay the cleared send.
    last().triggerEvent('online');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('drops a buffered send that aged past the TTL before reconnect', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.sendMessage('r@h', '', '', '', '', 'old', '', false, false, '', 'id-old');
    // Advance system clock past the TTL, then come online.
    jest.setSystemTime(1_000_000 + OUTBOUND_QUEUE_TTL_MS + 1);
    last().triggerEvent('online');
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(outboundQueueLength()).toBe(0);
    jest.useRealTimers();
  });
});
