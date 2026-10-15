/**
 * XmppClient receipt sends: a receipt is sent once per message (live or MAM),
 * the remembered set is capped, nothing is recorded while the stream is down,
 * and the read watermark is sent once per newest message and honours the
 * disable flags.
 */

jest.mock('@xmpp/client', () => {
  // The stanza builders are pure: keep the real `xml`, stub only the socket.
  const { xml } = jest.requireActual('@xmpp/client');
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

import XmppClient from '../src/networking/xmppClient';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';

const ROOM = 'room@conference.example.com';

function makeOnline(settings: Record<string, unknown> = {}) {
  const c = new XmppClient('u', 'p', { devServer: 'host', ...settings } as any);
  const send = jest.fn();
  (c as any).client = {
    send,
    jid: { toString: () => 'me_user@xmpp.example.com/web-1' },
  };
  (c as any).status = 'online';
  return { c, send };
}

const sentCount = (send: jest.Mock, prefix: string) =>
  send.mock.calls.filter((call) => String(call[0].attrs?.id || '').startsWith(prefix)).length;

afterEach(() => {
  store.dispatch(setConfig({} as any));
});

describe('sendReceivedReceiptStanza', () => {
  it('acks a message once, even when the same id comes again (live then MAM)', () => {
    const { c, send } = makeOnline();
    c.sendReceivedReceiptStanza('1700000000001', ROOM);
    c.sendReceivedReceiptStanza('1700000000001', ROOM);
    expect(sentCount(send, 'message-received:')).toBe(1);
  });

  it('keeps different messages apart, and different rooms apart', () => {
    const { c, send } = makeOnline();
    c.sendReceivedReceiptStanza('1700000000001', ROOM);
    c.sendReceivedReceiptStanza('1700000000002', ROOM);
    c.sendReceivedReceiptStanza('1700000000001', 'other@conference.example.com');
    expect(sentCount(send, 'message-received:')).toBe(3);
  });

  it('forgets the oldest ack once the remembered set passes its cap', () => {
    const { c, send } = makeOnline();
    c.sendReceivedReceiptStanza('first', ROOM);
    for (let i = 0; i < 2000; i++) {c.sendReceivedReceiptStanza(`m${i}`, ROOM);}
    send.mockClear();
    // "first" was evicted, so it is acked again; the newest one is still remembered.
    c.sendReceivedReceiptStanza('first', ROOM);
    c.sendReceivedReceiptStanza('m1999', ROOM);
    expect(sentCount(send, 'message-received:')).toBe(1);
  });

  it('records nothing while the stream is down, so a later page can still ack it', () => {
    const { c, send } = makeOnline();
    (c as any).status = 'offline';
    c.sendReceivedReceiptStanza('1700000000009', ROOM);
    expect(send).not.toHaveBeenCalled();
    (c as any).status = 'online';
    c.sendReceivedReceiptStanza('1700000000009', ROOM);
    expect(sentCount(send, 'message-received:')).toBe(1);
  });

  it('ignores a call without a message id or room', () => {
    const { c, send } = makeOnline();
    c.sendReceivedReceiptStanza('', ROOM);
    c.sendReceivedReceiptStanza('1700000000001', '');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('sendDisplayedMarkerStanza', () => {
  it('sends the watermark once per newest message', () => {
    const { c, send } = makeOnline();
    c.sendDisplayedMarkerStanza('1700000000002', ROOM);
    c.sendDisplayedMarkerStanza('1700000000002', ROOM);
    expect(sentCount(send, 'message-displayed:')).toBe(1);
    c.sendDisplayedMarkerStanza('1700000000003', ROOM);
    expect(sentCount(send, 'message-displayed:')).toBe(2);
  });

  it('sends nothing with disableLastRead on the client', () => {
    const { c, send } = makeOnline({ disableLastRead: true });
    c.sendDisplayedMarkerStanza('1700000000002', ROOM);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends neither marker nor delivery receipt with config.disableReadReceipts', () => {
    const { c, send } = makeOnline();
    store.dispatch(setConfig({ disableReadReceipts: true } as any));
    c.sendDisplayedMarkerStanza('1700000000002', ROOM);
    c.sendReceivedReceiptStanza('1700000000002', ROOM);
    expect(sentCount(send, 'message-displayed:')).toBe(0);
    expect(sentCount(send, 'message-received:')).toBe(0);
    // Turning it back on acks the same message (nothing was recorded while off).
    store.dispatch(setConfig({} as any));
    c.sendReceivedReceiptStanza('1700000000002', ROOM);
    expect(sentCount(send, 'message-received:')).toBe(1);
  });

  it('sends nothing while the stream is down, and sends once it is back', () => {
    const { c, send } = makeOnline();
    (c as any).status = 'offline';
    c.sendDisplayedMarkerStanza('1700000000002', ROOM);
    expect(send).not.toHaveBeenCalled();
    (c as any).status = 'online';
    c.sendDisplayedMarkerStanza('1700000000002', ROOM);
    expect(sentCount(send, 'message-displayed:')).toBe(1);
  });
});
