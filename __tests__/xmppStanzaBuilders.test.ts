/**
 * xmpp/*.xmpp.ts — stanza builder L1 tests.
 *
 * Each builder consumes the @xmpp/client `Client` + a few args and
 * `client.send(...)`s a hand-crafted XML stanza. We capture the
 * stanza off a fake client and inspect its attrs / children — same
 * style as the web sdk's stanza tests.
 *
 * Uses the REAL `@xmpp/client` `xml()` factory (no mock) so we don't
 * accidentally pin a fake stanza shape that drifts from production.
 */

import { sendTextMessage } from '../src/networking/xmpp/sendTextMessage.xmpp';
import { leaveTheRoom } from '../src/networking/xmpp/leaveTheRoom.xmpp';
import { deleteMessage } from '../src/networking/xmpp/deleteMessage.xmpp';
import { editMessage } from '../src/networking/xmpp/editMessage.xmpp';
import { sendTypingRequest } from '../src/networking/xmpp/sendTypingRequest.xmpp';
import { sendPing } from '../src/networking/xmpp/sendPing.xmpp';
import { isPong } from '../src/networking/xmpp/handlePong.xmpp';

// Minimal fake client. `client.jid` is a real-ish object with
// `toString()` + `getLocal()` — matching what @xmpp/client exposes.
function makeClient(opts: Partial<any> = {}) {
  const send = jest.fn(async () => undefined);
  const client: any = {
    send,
    on: jest.fn(),
    off: jest.fn(),
    status: opts.status || 'online',
    options: { service: 'wss://xmpp.test/ws' },
    jid: opts.jid || {
      toString: () => '0xabc@xmpp.test/web-1234',
      getLocal: () => '0xabc',
    },
    ...opts,
  };
  return { client, send };
}

const lastSent = (send: jest.Mock) =>
  send.mock.calls[send.mock.calls.length - 1][0];

// ----- sendTextMessage -----------------------------------------------

describe('sendTextMessage', () => {
  it('emits a <message type=groupchat> with data + body children and a generated id', () => {
    const { client, send } = makeClient();
    sendTextMessage(
      client,
      'r@conference.h',
      'Alice',
      'Anderson',
      '',
      '0xabc',
      'hello',
      '',
      false,
      false,
      ''
    );
    expect(send).toHaveBeenCalledTimes(1);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('message');
    expect(stanza.attrs.type).toBe('groupchat');
    expect(stanza.attrs.to).toBe('r@conference.h');
    expect(stanza.attrs.id).toMatch(/^send-text-message-\d+$/);

    const data = stanza.getChild('data');
    expect(data?.attrs?.senderFirstName).toBe('Alice');
    expect(data?.attrs?.senderLastName).toBe('Anderson');
    expect(data?.attrs?.fullName).toBe('Alice Anderson');
    expect(data?.attrs?.senderWalletAddress).toBe('0xabc');
    expect(data?.attrs?.roomJid).toBe('r@conference.h');
    // Service URL falls back to client.options.service when devServer
    // arg is absent.
    expect(data?.attrs?.xmlns).toBe('wss://xmpp.test/ws');

    const body = stanza.getChild('body');
    expect(body?.getText()).toBe('hello');
  });

  it('uses a `send-reply-message-` id when isReply=true', () => {
    const { client, send } = makeClient();
    sendTextMessage(
      client,
      'r@h',
      'A',
      'A',
      '',
      '0x',
      'hi',
      '',
      true,
      false,
      ''
    );
    expect(lastSent(send).attrs.id).toMatch(/^send-reply-message-\d+$/);
  });

  it('honours an explicit customId over any default', () => {
    const { client, send } = makeClient();
    sendTextMessage(
      client,
      'r@h',
      'A',
      'A',
      '',
      '0x',
      'hi',
      '',
      false,
      false,
      '',
      undefined,
      'my-correlation-id'
    );
    expect(lastSent(send).attrs.id).toBe('my-correlation-id');
  });

  it('uses the devServer arg to build the xmlns when client.options.service is absent', () => {
    const { client, send } = makeClient({ options: {} });
    sendTextMessage(
      client,
      'r@h',
      'A',
      'A',
      '',
      '0x',
      'hi',
      '',
      false,
      false,
      '',
      'xmpp.example.com'
    );
    const data = lastSent(send).getChild('data');
    expect(data?.attrs?.xmlns).toBe('wss://xmpp.example.com/ws');
  });
});

// ----- leaveTheRoom --------------------------------------------------

describe('leaveTheRoom', () => {
  it('sends an `unavailable` presence to <room>/<localpart>', () => {
    const { client, send } = makeClient();
    leaveTheRoom('r@conference.h', client);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('presence');
    expect(stanza.attrs.to).toBe('r@conference.h/0xabc');
    expect(stanza.attrs.type).toBe('unavailable');
  });

  it('throws when the client has no JID', () => {
    const { client } = makeClient({ jid: null });
    expect(() => leaveTheRoom('r@h', client)).toThrow(/Client JID is not set/);
  });
});

// ----- deleteMessage -------------------------------------------------

describe('deleteMessage', () => {
  it('sends a <message id=deleteMessageStanza> with a <delete id=msgId>', () => {
    const { client, send } = makeClient();
    deleteMessage(client, 'r@h', 'msg-42');
    const stanza = lastSent(send);
    expect(stanza.name).toBe('message');
    expect(stanza.attrs.id).toBe('deleteMessageStanza');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.type).toBe('groupchat');
    const del = stanza.getChild('delete');
    expect(del?.attrs?.id).toBe('msg-42');
  });
});

// ----- editMessage ---------------------------------------------------

describe('editMessage', () => {
  it('sends a <message id=edit-message-…> with a <replace id text>', async () => {
    const { client, send } = makeClient();
    await editMessage(client, 'r@h', 'msg-42', 'new body');
    const stanza = lastSent(send);
    expect(stanza.name).toBe('message');
    expect(stanza.attrs.id).toMatch(/^edit-message-\d+$/);
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.type).toBe('groupchat');
    const replace = stanza.getChild('replace');
    expect(replace?.attrs?.id).toBe('msg-42');
    expect(replace?.attrs?.text).toBe('new body');
  });
});

// ----- sendTypingRequest ---------------------------------------------

describe('sendTypingRequest', () => {
  it('start=true → <composing> child + `typing-…` id', () => {
    const { client, send } = makeClient();
    sendTypingRequest(client, 'r@h', 'Alice Anderson', true);
    const stanza = lastSent(send);
    expect(stanza.attrs.id).toMatch(/^typing-\d+$/);
    expect(stanza.getChild('composing')).toBeDefined();
    expect(stanza.getChild('paused')).toBeFalsy();
    expect(stanza.getChild('data')?.attrs?.fullName).toBe('Alice Anderson');
  });

  it('start=false → <paused> child + `stop-typing-…` id', () => {
    const { client, send } = makeClient();
    sendTypingRequest(client, 'r@h', 'Bob', false);
    const stanza = lastSent(send);
    expect(stanza.attrs.id).toMatch(/^stop-typing-\d+$/);
    expect(stanza.getChild('paused')).toBeDefined();
    expect(stanza.getChild('composing')).toBeFalsy();
  });
});

// ----- sendPing ------------------------------------------------------

describe('sendPing', () => {
  it('sends an <iq type=get> with an XMPP <ping> child and returns the id', () => {
    const { client, send } = makeClient();
    const id = sendPing(client, 'xmpp.test');
    expect(id).toMatch(/^ping-\d+-\d+$/);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('get');
    expect(stanza.attrs.to).toBe('xmpp.test');
    expect(stanza.attrs.id).toBe(id);
    expect(stanza.getChild('ping')).toBeDefined();
  });

  it('honours an explicit ping id', () => {
    const { client, send } = makeClient();
    const id = sendPing(client, 'xmpp.test', 'my-ping-id');
    expect(id).toBe('my-ping-id');
    expect(lastSent(send).attrs.id).toBe('my-ping-id');
  });

  it('returns null and does NOT send when the client is offline / closing / closed', () => {
    for (const state of [{ status: 'offline' }, { _status: 'closing' }, { _status: 'closed' }]) {
      const { client, send } = makeClient({ status: state.status || 'online', ...state });
      const id = sendPing(client, 'xmpp.test');
      expect(id).toBeNull();
      expect(send).not.toHaveBeenCalled();
    }
  });
});

// ----- isPong --------------------------------------------------------

describe('isPong', () => {
  // Build something stanza-shaped — `stanza.is('iq')` checks name +
  // attrs.id / attrs.type.
  const stanza = (name: string, attrs: Record<string, string>) => ({
    is: (n: string) => n === name,
    attrs,
  });

  it('true for an iq with matching id + type=result', () => {
    expect(isPong(stanza('iq', { id: 'ping-1', type: 'result' }), 'ping-1')).toBe(
      true
    );
  });
  it('false when id mismatches', () => {
    expect(isPong(stanza('iq', { id: 'ping-2', type: 'result' }), 'ping-1')).toBe(
      false
    );
  });
  it('false for non-iq stanzas', () => {
    expect(
      isPong(stanza('message', { id: 'ping-1', type: 'result' }), 'ping-1')
    ).toBe(false);
  });
  it('false when type is not "result"', () => {
    expect(isPong(stanza('iq', { id: 'ping-1', type: 'get' }), 'ping-1')).toBe(
      false
    );
  });
});
