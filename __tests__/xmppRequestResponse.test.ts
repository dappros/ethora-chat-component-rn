/**
 * xmpp request/response helpers — MAM history, room info, room
 * members, last archive, paged rooms, room config.
 *
 * Each helper sends a request stanza and either:
 *   (a) fires-and-forgets (getRoomInfo, getRoomMembers, getLastMessage)
 *   (b) listens for a matching iq+id and resolves the response
 *   (c) races a 2-10s timeout for safety
 *
 * Uses a fake @xmpp/client + the real `xml()` factory.
 */

import { getRoomInfo } from '../src/networking/xmpp/getRoomInfo.xmpp';
import { getRoomMembers } from '../src/networking/xmpp/getRoomMembers.xmpp';
import { getLastMessage } from '../src/networking/xmpp/getLastMessageArchive.xmpp';
import { getRoomsPaged } from '../src/networking/xmpp/getRoomsPaged.xmpp';
import { roomConfig } from '../src/networking/xmpp/roomConfig.xmpp';
import { getHistory } from '../src/networking/xmpp/getHistory.xmpp';

function makeClient(opts: Partial<any> = {}) {
  const listeners: Record<string, ((arg: any) => void)[]> = {};
  const send = jest.fn(async () => undefined);
  const client: any = {
    send,
    on: jest.fn((event: string, fn: any) => {
      (listeners[event] = listeners[event] || []).push(fn);
    }),
    off: jest.fn((event: string, fn: any) => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== fn);
    }),
    status: 'online',
    options: { service: 'wss://xmpp.test/ws' },
    jid: opts.jid || {
      toString: () => '0xabc@xmpp.test/web',
      getLocal: () => '0xabc',
    },
    trigger: (event: string, payload: any) =>
      (listeners[event] || []).slice().forEach((fn) => fn(payload)),
    ...opts,
  };
  return { client, send };
}

const lastSent = (send: jest.Mock) =>
  send.mock.calls[send.mock.calls.length - 1][0];

// ---- getRoomInfo ----------------------------------------------------

describe('getRoomInfo', () => {
  it('emits an <iq type=get id=roomInfo> with a disco#info query', () => {
    const { client, send } = makeClient();
    getRoomInfo('r@h', client);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('get');
    expect(stanza.attrs.id).toBe('roomInfo');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.getChild('query')?.attrs?.xmlns).toBe(
      'http://jabber.org/protocol/disco#info'
    );
  });
});

// ---- getRoomMembers -------------------------------------------------

describe('getRoomMembers', () => {
  it('emits an <iq type=get id=roomMemberInfo> with ns:room:last query carrying the room', () => {
    const { client, send } = makeClient();
    getRoomMembers('r@conference.h', client);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.id).toBe('roomMemberInfo');
    expect(stanza.attrs.type).toBe('get');
    const q = stanza.getChild('query');
    expect(q?.attrs?.xmlns).toBe('ns:room:last');
    expect(q?.attrs?.room).toBe('r@conference.h');
  });
});

// ---- getLastMessage (MAM archive) -----------------------------------

describe('getLastMessage', () => {
  it('emits an <iq type=set id=GetArchive> with mam:2 query + RSM <max>1</max><before/>', () => {
    const { client, send } = makeClient();
    getLastMessage(client, 'r@h');
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.id).toBe('GetArchive');
    expect(stanza.attrs.type).toBe('set');
    expect(stanza.attrs.to).toBe('r@h');
    const q = stanza.getChild('query');
    expect(q?.attrs?.xmlns).toBe('urn:xmpp:mam:2');
    const rsm = q.getChild('set');
    expect(rsm?.attrs?.xmlns).toBe('http://jabber.org/protocol/rsm');
    expect(rsm.getChild('max')?.getText()).toBe('1');
    expect(rsm.getChild('before')).toBeDefined();
  });
});

// ---- getRoomsPaged --------------------------------------------------

describe('getRoomsPaged', () => {
  it('emits an iq id=getUserRoomsPaged with ns:getrooms query + RSM max', async () => {
    const { client, send } = makeClient();
    jest.useFakeTimers();
    const p = getRoomsPaged(client, 5);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('get');
    expect(stanza.attrs.id).toBe('getUserRoomsPaged');
    const q = stanza.getChild('query');
    expect(q?.attrs?.xmlns).toBe('ns:getrooms');
    expect(q.getChild('set')?.getChild('max')?.getText()).toBe('5');

    // resolve via matching iq id=getUserRooms (NOTE: filter key
    // differs from request id — pinning the existing contract).
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: 'getUserRooms' },
    });
    await expect(p).resolves.toBeDefined();
    jest.useRealTimers();
  });

  it('includes <before>token</before> when supplied', async () => {
    const { client, send } = makeClient();
    jest.useFakeTimers();
    const p = getRoomsPaged(client, 5, 'cursor-token' as any);
    const stanza = lastSent(send);
    const set = stanza.getChild('query').getChild('set');
    expect(set.getChild('before')?.getText()).toBe('cursor-token');
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: 'getUserRooms' },
    });
    await p;
    jest.useRealTimers();
  });
});

// ---- roomConfig -----------------------------------------------------

describe('roomConfig', () => {
  it('emits an MUC#owner submit form with roomname + roomdesc fields', () => {
    const { client, send } = makeClient();
    // Don't await — we don't want to wait for the 2s timeout.
    roomConfig('r@h', 'My Room', 'A description', client).catch(() => {});
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('set');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.id).toMatch(/^room-config:\d+$/);

    const q = stanza.getChild('query');
    expect(q?.attrs?.xmlns).toBe('http://jabber.org/protocol/muc#owner');
    const x = q.getChild('x');
    expect(x?.attrs?.type).toBe('submit');

    const fields = x.getChildren('field');
    const byVar = (v: string) => fields.find((f: any) => f.attrs?.var === v);
    expect(byVar('FORM_TYPE')?.getChild('value')?.getText()).toBe(
      'http://jabber.org/protocol/muc#roomconfig'
    );
    expect(byVar('muc#roomconfig_roomname')?.getChild('value')?.getText()).toBe(
      'My Room'
    );
    expect(byVar('muc#roomconfig_roomdesc')?.getChild('value')?.getText()).toBe(
      'A description'
    );
  });

  it('resolves true when the server replies with a matching iq result', async () => {
    const { client, send } = makeClient();
    const p = roomConfig('r@h', 't', 'd', client);
    const stanza = lastSent(send);
    client.trigger('stanza', {
      attrs: { id: stanza.attrs.id, type: 'result' },
    });
    await expect(p).resolves.toBe(true);
  });

  it('times out and rejects after 2 seconds without a matching reply', async () => {
    const { client } = makeClient();
    jest.useFakeTimers();
    const p = roomConfig('r@h', 't', 'd', client);
    const settled = p.then(
      () => 'resolved',
      () => 'rejected'
    );
    jest.advanceTimersByTime(2001);
    await expect(settled).resolves.toBe('rejected');
    jest.useRealTimers();
  });
});

// ---- getHistory -----------------------------------------------------

describe('getHistory', () => {
  it('returns early (no stanza) when chatJID is not a string', async () => {
    const { client, send } = makeClient();
    // @ts-expect-error — we WANT to test the non-string branch
    const res = await getHistory(client, null, 10);
    expect(res).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('emits an MAM iq + resolves [] when the iq result arrives with no messages', async () => {
    const { client, send } = makeClient();
    const p = getHistory(client, 'r@h', 25, undefined, 'hist-id-1');
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('set');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.id).toBe('hist-id-1');
    const q = stanza.getChild('query');
    expect(q?.attrs?.xmlns).toBe('urn:xmpp:mam:2');
    expect(q.getChild('set')?.getChild('max')?.getText()).toBe('25');
    // No `before` arg → empty <before/> placeholder.
    expect(q.getChild('set')?.getChild('before')).toBeDefined();

    // Synthesize the iq=result terminator (no message stanzas in
    // between) — should resolve to [].
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      getChild: () => undefined,
      attrs: { id: 'hist-id-1', type: 'result' },
    });
    await expect(p).resolves.toEqual([]);
  });

  it('synthesises a conference JID when the caller passes a bare local part', async () => {
    const { client, send } = makeClient();
    const p = getHistory(client, 'just-local', 10, undefined, 'hist-id-2');
    const stanza = lastSent(send);
    // service URL is wss://xmpp.test/ws → host xmpp.test → conference.xmpp.test
    expect(stanza.attrs.to).toBe('just-local@conference.xmpp.test');
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      getChild: () => undefined,
      attrs: { id: 'hist-id-2', type: 'result' },
    });
    await p;
  });

  it('includes <before>ts</before> when the before arg is supplied', async () => {
    const { client, send } = makeClient();
    const p = getHistory(client, 'r@h', 10, 1700000000000, 'hist-id-3');
    const stanza = lastSent(send);
    expect(
      stanza.getChild('query').getChild('set').getChild('before').getText()
    ).toBe('1700000000000');
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      getChild: () => undefined,
      attrs: { id: 'hist-id-3', type: 'result' },
    });
    await p;
  });

  it('returns [] when the iq=error terminator arrives', async () => {
    const { client } = makeClient();
    const p = getHistory(client, 'r@h', 10, undefined, 'hist-id-4');
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      getChild: () => undefined,
      attrs: { id: 'hist-id-4', type: 'error' },
    });
    // The catch in the outer try returns [] — pin that contract.
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(p).resolves.toEqual([]);
    logSpy.mockRestore();
  });

  it('collects message stanzas before the terminating iq and returns parsed IMessages', async () => {
    const { client } = makeClient();
    const p = getHistory(client, 'r@h', 10, undefined, 'hist-id-5');

    // Build a minimal MAM-style stanza wrapper that getHistory walks:
    //   <message from=…><result><forwarded><message>
    //     <body>...</body><data attr=val/></message></forwarded></result></message>
    // The inner message must expose getChild('body'), getChild('data')
    // and a few attrs since createMessageFromXml + getDataFromXml read
    // them.
    const innerMessage = {
      attrs: {
        id: '1700000000000000xyz',
        from: 'r@h/sender',
      },
      getChild: (name: string) => {
        if (name === 'body') {return { getText: () => 'hello' };}
        if (name === 'data') {
          return {
            attrs: {
              senderFirstName: 'Alice',
              senderLastName: 'Anderson',
              senderJID: 'alice@host',
              photo: '',
            },
          };
        }
        return undefined;
      },
    };
    const forwarded = {
      getChild: (n: string) => (n === 'message' ? innerMessage : undefined),
    };
    const result = {
      getChild: (n: string) => (n === 'forwarded' ? forwarded : undefined),
    };
    const messageStanza = {
      is: (n: string) => n === 'message',
      attrs: { from: 'r@h/sender' },
      getChild: (n: string) => (n === 'result' ? result : undefined),
    };

    client.trigger('stanza', messageStanza);

    // Terminator.
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      getChild: () => undefined,
      attrs: { id: 'hist-id-5', type: 'result' },
    });

    const msgs = await p;
    expect(msgs).toHaveLength(1);
    expect(msgs![0].body).toBe('hello');
    expect(msgs![0].user.name).toBe('Alice Anderson');
  });
});
