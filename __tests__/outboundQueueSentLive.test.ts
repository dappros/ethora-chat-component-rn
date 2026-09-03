/**
 * Regression tests for customer-reported #31 — "a message the server
 * accepted is delivered, shown as failed, and then sent AGAIN
 * automatically, so the recipient gets a duplicate."
 *
 * The duplicate came from the outbound queue: every send is buffered
 * BEFORE it is attempted (to cover a stanza vanishing into a dying
 * socket), and `flushOutboundSends` replayed anything inside its TTL on
 * the next 'online' event. A send is immediately followed by
 * `ensureStreamAlive()`, whose 4s "did any stanza come back" probe
 * force-reconnects a healthy-but-quiet stream — and that reconnect
 * replayed a stanza that had already reached the server.
 */
import {
  clearOutboundSends,
  enqueueOutboundSend,
  flushOutboundSends,
  markOutboundSentLive,
  outboundQueueLength,
  removeOutboundSend,
} from '../src/networking/outboundQueue';

const makeClient = () => ({
  sendMessage: jest.fn(),
  sendTextMessageWithTranslateTagStanza: jest.fn(),
  sendMediaMessageStanza: jest.fn(),
});

describe('outboundQueue — no blind replay of already-sent stanzas (#31)', () => {
  beforeEach(() => clearOutboundSends());

  it('does NOT replay a send that already reached a live stream', () => {
    const send = jest.fn();
    enqueueOutboundSend({
      optimisticId: 'm1',
      roomJID: 'r@h',
      enqueuedAt: Date.now(),
      send,
    });
    // The stanza went out on a live, online stream.
    markOutboundSentLive('m1');

    // A reconnect (e.g. triggered by ensureStreamAlive's 4s probe) flushes.
    flushOutboundSends(makeClient(), Date.now());

    expect(send).not.toHaveBeenCalled();
  });

  it('DOES still replay a send that never made it onto the wire', () => {
    const send = jest.fn();
    enqueueOutboundSend({
      optimisticId: 'm2',
      roomJID: 'r@h',
      enqueuedAt: Date.now(),
      send,
    });
    // No markOutboundSentLive — the client was offline at send time.
    flushOutboundSends(makeClient(), Date.now());

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('still drops entries older than the TTL', () => {
    const send = jest.fn();
    const now = Date.now();
    enqueueOutboundSend({
      optimisticId: 'm3',
      roomJID: 'r@h',
      enqueuedAt: now - 60_000,
      send,
    });
    flushOutboundSends(makeClient(), now);
    expect(send).not.toHaveBeenCalled();
  });

  it('server echo removes the buffered copy entirely', () => {
    enqueueOutboundSend({
      optimisticId: 'm4',
      roomJID: 'r@h',
      enqueuedAt: Date.now(),
      send: jest.fn(),
    });
    expect(outboundQueueLength()).toBe(1);
    removeOutboundSend('m4');
    expect(outboundQueueLength()).toBe(0);
  });

  it('markOutboundSentLive is a no-op for unknown/empty ids', () => {
    expect(() => markOutboundSentLive('')).not.toThrow();
    expect(() => markOutboundSentLive('nope')).not.toThrow();
  });
});
