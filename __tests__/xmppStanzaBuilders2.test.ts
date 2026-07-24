/**
 * xmpp/*.xmpp.ts — second bundle of stanza builder tests.
 *
 * Covers the rest of the fire-and-forget + request-response stanza
 * helpers: inviteRoomRequest, setRoomImage, setVcard,
 * sendMessageReaction, setMeAsOwner (request-response), and
 * sendTextMessageWithTranslateTag, sendMediaMessage,
 * setChatsPrivateStoreRequest.
 *
 * Same fake-client pattern as xmppStanzaBuilders.test.ts.
 */

import { inviteRoomRequest } from '../src/networking/xmpp/inviteRoomRequest.xmpp';
import { setRoomImage } from '../src/networking/xmpp/setRoomImage.xmpp';
import { setVcard } from '../src/networking/xmpp/setVCard.xmpp';
import { sendMessageReaction } from '../src/networking/xmpp/sendMessageReaction.xmpp';
import { setMeAsOwner } from '../src/networking/xmpp/setMeAsOwner.xmpp';
import { sendTextMessageWithTranslateTag } from '../src/networking/xmpp/sendTextMessageWithTranslateTag.xmpp';
import { sendMediaMessage } from '../src/networking/xmpp/sendMediaMessage.xmpp';
import { setChatsPrivateStoreRequest } from '../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp';

function makeClient(opts: Partial<any> = {}) {
  const listeners: Record<string, ((arg: any) => void)[]> = {};
  const send = jest.fn(async () => undefined);
  const client: any = {
    send,
    on: jest.fn((event: string, fn: (arg: any) => void) => {
      (listeners[event] = listeners[event] || []).push(fn);
    }),
    off: jest.fn((event: string, fn: any) => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== fn);
    }),
    status: 'online',
    options: { service: 'wss://xmpp.test/ws' },
    jid: opts.jid || {
      toString: () => '0xabc@xmpp.test/web-1234',
      getLocal: () => '0xabc',
    },
    trigger: (event: string, arg: any) =>
      (listeners[event] || []).slice().forEach((fn) => fn(arg)),
    ...opts,
  };
  return { client, send };
}

const lastSent = (send: jest.Mock) =>
  send.mock.calls[send.mock.calls.length - 1][0];

// ---- inviteRoomRequest ----------------------------------------------

describe('inviteRoomRequest', () => {
  it('emits a <message> to the room with an MUC <x><invite to=…@xmpp.ethoradev.com>', async () => {
    const { client, send } = makeClient();
    await inviteRoomRequest(client, 'invitee-local', 'r@conference.h');
    const stanza = lastSent(send);
    expect(stanza.name).toBe('message');
    expect(stanza.attrs.to).toBe('r@conference.h');
    expect(stanza.attrs.id).toMatch(/^invite-rooms:\d+$/);

    const x = stanza.getChild('x');
    expect(x).toBeDefined();
    const invite = x.getChild('invite');
    expect(invite?.attrs?.to).toBe('invitee-local@xmpp.ethoradev.com');
  });
});

// ---- setRoomImage ---------------------------------------------------

describe('setRoomImage', () => {
  it('icon type → iq id=setRoomImage', () => {
    const { client, send } = makeClient();
    setRoomImage('r@h', 'http://img/icon.png', 'icon', client);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.id).toBe('setRoomImage');
    expect(stanza.attrs.type).toBe('set');
    const q = stanza.getChild('query');
    expect(q?.attrs?.room).toBe('r@h');
    expect(q?.attrs?.room_thumbnail).toBe('http://img/icon.png');
    expect(q?.attrs?.room_background).toBe('');
  });

  it('non-icon type → iq id=setRoomBackgroundImage + background URL forwarded', () => {
    const { client, send } = makeClient();
    setRoomImage('r@h', 'thumb', 'background', client, 'http://img/bg.png');
    const stanza = lastSent(send);
    expect(stanza.attrs.id).toBe('setRoomBackgroundImage');
    const q = stanza.getChild('query');
    expect(q?.attrs?.room_background).toBe('http://img/bg.png');
  });
});

// ---- setVcard -------------------------------------------------------

describe('setVcard', () => {
  it('emits an <iq type=set id=setVcard> with a <vCard><FN>fullname</FN></vCard>', () => {
    const { client, send } = makeClient();
    setVcard('Alice Anderson', client);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.id).toBe('setVcard');
    expect(stanza.attrs.type).toBe('set');
    const vCard = stanza.getChild('vCard');
    expect(vCard?.attrs?.xmlns).toBe('vcard-temp');
    expect(vCard?.getChild('FN')?.getText()).toBe('Alice Anderson');
  });
});

// ---- sendMessageReaction -------------------------------------------

describe('sendMessageReaction', () => {
  it('emits a <message type=groupchat> with <reactions xmlns> and one <reaction> per code', () => {
    const { client, send } = makeClient();
    sendMessageReaction(
      client,
      'msg-1',
      'r@h',
      ['joy', 'heart'],
      { firstName: 'Alice', lastName: 'Anderson' }
    );
    const stanza = lastSent(send);
    expect(stanza.name).toBe('message');
    expect(stanza.attrs.type).toBe('groupchat');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.id).toMatch(/^message-reaction:\d+$/);

    const reactions = stanza.getChild('reactions');
    expect(reactions?.attrs?.id).toBe('msg-1');
    expect(reactions?.attrs?.xmlns).toBe('urn:xmpp:reactions:0');
    const codes = reactions
      .getChildren('reaction')
      .map((r: any) => r.getText());
    expect(codes).toEqual(['joy', 'heart']);

    const data = stanza.getChild('data');
    expect(data?.attrs?.senderFirstName).toBe('Alice');
    expect(data?.attrs?.senderLastName).toBe('Anderson');

    // urn:xmpp:hints / store child is required for server persistence.
    expect(stanza.getChild('store')).toBeDefined();
  });

  it('coerces empty strings for null/undefined reaction codes', () => {
    const { client, send } = makeClient();
    sendMessageReaction(
      client,
      'msg-2',
      'r@h',
      [null as any, undefined as any, 'fire'],
      { firstName: 'X', lastName: 'Y' }
    );
    const stanza = lastSent(send);
    const codes = stanza
      .getChild('reactions')
      .getChildren('reaction')
      .map((r: any) => r.getText());
    expect(codes).toEqual(['', '', 'fire']);
  });
});

// ---- setMeAsOwner (request-response with timeout) -------------------

describe('setMeAsOwner', () => {
  it('emits an <iq type=set> with MUC#owner query and resolves on matching iq result', async () => {
    const { client, send } = makeClient();
    const p = setMeAsOwner('r@h', client);
    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('set');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.id).toMatch(/^set-me-as-owner:\d+$/);
    const query = stanza.getChild('query');
    expect(query?.attrs?.xmlns).toBe('http://jabber.org/protocol/muc#owner');

    // Synthesize the matching iq=result on the listener.
    const sentId = stanza.attrs.id;
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: sentId, type: 'result' },
    });
    await expect(p).resolves.toBe(true);
  });

  it('rejects (via the createTimeoutPromise) when no matching result arrives', async () => {
    const { client } = makeClient();
    // createTimeoutPromise rejects with `undefined` after 2000ms; use
    // fake timers so the test doesn't actually wait two seconds.
    jest.useFakeTimers();
    const p = setMeAsOwner('r@h', client);
    // Pre-attach the rejection handler so the runtime sees it and
    // doesn't trip "unhandled promise rejection" in the meantime.
    const rejected = p.then(
      () => 'resolved',
      () => 'rejected'
    );
    jest.advanceTimersByTime(2001);
    await expect(rejected).resolves.toBe('rejected');
    jest.useRealTimers();
  });
});

// ---- sendTextMessageWithTranslateTag --------------------------------

describe('sendTextMessageWithTranslateTag', () => {
  it('emits a <message type=groupchat> with data + body + <translate source>', () => {
    const { client, send } = makeClient();
    sendTextMessageWithTranslateTag(
      client,
      {
        roomJID: 'r@h',
        firstName: 'Alice',
        lastName: 'A',
        photo: '',
        walletAddress: '0xa',
        userMessage: 'hola',
      },
      'es' as any
    );
    const stanza = lastSent(send);
    expect(stanza.name).toBe('message');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.type).toBe('groupchat');
    // Default id uses the same `send-text-message-` prefix as the plain
    // send so the server echo correlates with the optimistic bubble.
    expect(stanza.attrs.id).toMatch(/^send-text-message-\d+$/);
    expect(stanza.getChild('body')?.getText()).toBe('hola');
    expect(stanza.getChild('translate')?.attrs?.source).toBe('es');

    // The <data> element MUST mirror the plain sendTextMessage: the service
    // `xmlns` and the `senderFirstName` / `senderJID` / `roomJid` attr names
    // the server + parser expect. Without these the server silently drops
    // the stanza (no echo) and the message stays stuck in "pending".
    const data = stanza.getChild('data');
    expect(data?.attrs?.xmlns).toBe('wss://xmpp.test/ws');
    expect(data?.attrs?.senderFirstName).toBe('Alice');
    expect(data?.attrs?.senderLastName).toBe('A');
    expect(data?.attrs?.senderJID).toBe('0xabc@xmpp.test/web-1234');
    expect(data?.attrs?.roomJid).toBe('r@h');
    expect(data?.attrs?.push).toBe('true');
  });

  it('honours an explicit customId', () => {
    const { client, send } = makeClient();
    sendTextMessageWithTranslateTag(
      client,
      {
        roomJID: 'r@h',
        firstName: 'A',
        lastName: 'A',
        photo: '',
        walletAddress: '0xa',
        userMessage: 'hi',
      },
      'en' as any,
      'corr-1'
    );
    expect(lastSent(send).attrs.id).toBe('corr-1');
  });

  it('swallows a sync send error without throwing (logs only)', () => {
    const { client, send } = makeClient();
    send.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      sendTextMessageWithTranslateTag(
        client,
        {
          roomJID: 'r@h',
          firstName: 'A',
          lastName: 'A',
          photo: '',
          walletAddress: '0xa',
          userMessage: 'x',
        },
        'en' as any
      )
    ).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(
      'An error occurred while sending message:',
      expect.any(Error)
    );
    errSpy.mockRestore();
  });
});

// ---- sendMediaMessage ----------------------------------------------

describe('sendMediaMessage', () => {
  const baseData = {
    firstName: 'Alice',
    lastName: 'Anderson',
    walletAddress: '0xabc',
    chatName: 'Room',
    userAvatar: 'http://img/a.png',
    createdAt: '2026-05-15T00:00:00Z',
    expiresAt: '2026-06-15T00:00:00Z',
    fileName: 'doc.pdf',
    isVisible: true,
    location: 'http://files/doc.pdf',
    locationPreview: 'http://files/doc-preview.png',
    mimetype: 'application/pdf',
    originalName: 'doc.pdf',
    ownerKey: 'ok',
    size: '1024',
    duration: '0',
    updatedAt: '2026-05-15T00:00:00Z',
    userId: 'u1',
    waveForm: '',
    attachmentId: 'aid',
    isReply: false,
    showInChannel: false,
    mainMessage: '',
    roomJid: 'r@h',
  };

  it('returns the correlation id and emits a <message> with body=media + data + store hint', () => {
    const { client, send } = makeClient();
    const id = sendMediaMessage(client, 'r@h', baseData);
    expect(id).toMatch(/^send-media-message-\d+-\d+$/);
    const stanza = lastSent(send);
    expect(stanza.attrs.id).toBe(id);
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.getChild('body')?.getText()).toBe('media');
    expect(stanza.getChild('store')?.attrs?.xmlns).toBe('urn:xmpp:hints');
    const data = stanza.getChild('data');
    // ltx/xmpp coerces attr values to strings — pin the wire shape.
    expect(data?.attrs?.isMediafile).toBe('true');
    expect(data?.attrs?.mimetype).toBe('application/pdf');
    expect(data?.attrs?.fileName).toBe('doc.pdf');
    expect(data?.attrs?.senderWalletAddress).toBe('0xabc');
    expect(data?.attrs?.xmlns).toBe('wss://xmpp.test/ws');
  });

  it('honours an explicit customId', () => {
    const { client, send } = makeClient();
    const id = sendMediaMessage(client, 'r@h', baseData, 'media-corr-1');
    expect(id).toBe('media-corr-1');
    expect(lastSent(send).attrs.id).toBe('media-corr-1');
  });
});

// ---- setChatsPrivateStoreRequest ------------------------------------

describe('setChatsPrivateStoreRequest', () => {
  it('emits an <iq type=set><query xmlns=jabber:iq:private><chatjson value=…/></query></iq>', async () => {
    const { client, send } = makeClient();
    const json = JSON.stringify({ 'r@h': 1700000000000 });
    const p = setChatsPrivateStoreRequest(client, json);

    const stanza = lastSent(send);
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('set');
    expect(stanza.attrs.id).toMatch(/^set-chats-private-req:\d+$/);
    const q = stanza.getChild('query');
    expect(q?.attrs?.xmlns).toBe('jabber:iq:private');
    const chatjson = q.getChild('chatjson');
    expect(chatjson?.attrs?.xmlns).toBe('chatjson:store');
    expect(chatjson?.attrs?.value).toBe(json);

    // Resolve via matching iq.
    const sentId = stanza.attrs.id;
    client.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: sentId },
    });
    await expect(p).resolves.toBe(true);
  });
});
