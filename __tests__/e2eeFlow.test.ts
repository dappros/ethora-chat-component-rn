/**
 * E2EE, phases 3-4 - reading and writing encrypted text.
 *
 * Receive: an OMEMO stanza is rewritten in place (e2ee/stanza.ts) into the
 * stanza an unencrypted sender would have produced, whichever wrapper it
 * arrived in. Send: in an encrypted room the body goes out inside an OMEMO
 * payload, with <data> beside it in the clear, and falls back to a clear
 * message when there is nobody to encrypt for (e2ee/send.ts).
 *
 * One side of each exchange is the app itself - the module-level instance
 * the SDK starts from `config.e2ee.enabled` - and the other a second device
 * built directly, both over the same in-memory PEP.
 */

jest.mock('../src/e2ee/deviceStore', () => {
  const { createMemoryBackend, createStore } = jest.requireActual('../src/e2ee/store');
  const backend = createMemoryBackend();
  return { openDeviceStore: async (jid: string) => createStore(backend, jid) };
});

// The backend, for the one call this path makes: the members of a room.
const mockHttpGet = jest.fn();
const mockHttpPost = jest.fn();
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockHttpGet(...args),
    post: (...args: any[]) => mockHttpPost(...args),
  },
  getCurrentBaseURL: () => '',
}));

import { xml } from '@xmpp/client';
import { Element } from 'ltx';
import { fakeClient, type Pep } from './fixtures/fakePep';
import { store } from '../src/roomStore';
import { addRoom } from '../src/roomStore/roomsSlice';
import { Omemo } from '../src/e2ee/omemo';
import { createMemoryStore } from '../src/e2ee/store';
import {
  __resetE2eeForTests,
  canSendMediaToRoom,
  canSendToRoom,
  omemoReady,
  onOnline,
  resolveRecipients,
  roomRecipients,
  setE2eeEnabled,
} from '../src/e2ee';
import {
  clearRoomsRestCache,
  getRooms,
  postPrivateRoom,
} from '../src/networking/api-requests/rooms.api';
import { setUser } from '../src/roomStore/chatSettingsSlice';
import { decryptStanzaInPlace, placeholderKey } from '../src/e2ee/stanza';
import { parseSealedMediaBody } from '../src/e2ee/sealedBody';
import { sendTextMessage } from '../src/networking/xmpp/sendTextMessage.xmpp';
import { sendMediaMessage } from '../src/networking/xmpp/sendMediaMessage.xmpp';
import { sendTextMessageWithTranslateTag } from '../src/networking/xmpp/sendTextMessageWithTranslateTag.xmpp';
import { createMessageFromXml } from '../src/helpers/createMessageFromXml';
import type { IRoom } from '../src/types/types';

const DOMAIN = 'localhost';
const ROOM = 'secret@conference.localhost';
const PLAIN_ROOM = 'plain@conference.localhost';
const ME = `me@${DOMAIN}`;
const PEER = `peer@${DOMAIN}`;
/** An encrypted room restored from the cache: the roster is not persisted. */
const CACHED_ROOM = 'cached@conference.localhost';

const makeRoom = (jid: string, e2ee: boolean): IRoom =>
  ({
    id: jid,
    name: jid.split('@')[0],
    jid,
    title: jid.split('@')[0],
    usersCnt: 2,
    messages: [],
    isLoading: false,
    roomBg: null,
    e2ee,
    members: [{ xmppUsername: 'me' }, { xmppUsername: 'Peer' }],
  } as unknown as IRoom);

beforeAll(() => {
  jest.useFakeTimers();
  store.dispatch(addRoom({ roomData: makeRoom(ROOM, true) }));
  store.dispatch(addRoom({ roomData: makeRoom(PLAIN_ROOM, false) }));
  store.dispatch(
    addRoom({ roomData: { ...makeRoom(CACHED_ROOM, true), members: undefined } as IRoom })
  );
  jest.clearAllTimers();
  jest.useRealTimers();
});

const content = (text: string) => [xml('body', {}, text)];
const metadata = () => [xml('data', { xmlns: 'ethora', senderFirstName: 'Peer' })];
/** What the server does to a stanza: nothing is shared by reference. */
const overTheWire = (stanza: Element, from: string) => {
  const copy = require('ltx').parse(stanza.toString()) as Element;
  copy.attrs.from = from;
  return copy;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The app (`me`) with encryption on, and a peer device beside it. */
async function appAndPeer(options: { peerHasDevice?: boolean } = {}) {
  const pep: Pep = new Map();
  const myClient = fakeClient(pep, ME);
  setE2eeEnabled(true);
  onOnline(myClient as never);
  const me = (await omemoReady())!;
  await me.published();
  const peer =
    options.peerHasDevice === false
      ? undefined
      : await Omemo.create(fakeClient(pep, PEER) as never, PEER, createMemoryStore());
  return { pep, me, myClient, peer };
}

beforeEach(() => {
  __resetE2eeForTests();
  mockHttpGet.mockReset();
  mockHttpPost.mockReset();
});
afterAll(() => __resetE2eeForTests());

describe('reading', () => {
  it('turns an encrypted message back into an ordinary one', async () => {
    const { peer } = await appAndPeer();
    const sent = await peer!.encryptGroupMessage(ROOM, [ME, PEER], content('hello <you> & me'), 'm-1', metadata());
    const stanza = overTheWire(sent, `${ROOM}/peer`);

    expect(await decryptStanzaInPlace(stanza, DOMAIN)).toBe('decrypted');
    expect(stanza.getChildText('body')).toBe('hello <you> & me');
    expect(stanza.getChild('encrypted')).toBeUndefined();
    expect(stanza.getChildren('body')).toHaveLength(1);

    // The sender's own <data>, marked as having arrived protected.
    const data = stanza.getChild('data')!;
    expect(data.attrs.senderFirstName).toBe('Peer');
    expect(data.attrs.omemoEncrypted).toBe('true');
    expect(data.attrs.undecryptable).toBeUndefined();
    expect(stanza.getChildren('data')).toHaveLength(1);
  });

  it('reads the same message again from an archive page and a mucsub event', async () => {
    const { peer } = await appAndPeer();
    const sent = await peer!.encryptGroupMessage(ROOM, [ME, PEER], content('once'), 'm-2', metadata());

    const live = overTheWire(sent, `${ROOM}/peer`);
    expect(await decryptStanzaInPlace(live, DOMAIN)).toBe('decrypted');

    // Message keys are single-use: the replays work off the device's cache.
    const inner = overTheWire(sent, `${ROOM}/peer`);
    const mam = xml(
      'message',
      { from: ROOM },
      xml('result', { xmlns: 'urn:xmpp:mam:2', id: '1' }, xml('forwarded', {}, inner))
    );
    expect(await decryptStanzaInPlace(mam, DOMAIN)).toBe('decrypted');
    expect(inner.getChildText('body')).toBe('once');

    const inner2 = overTheWire(sent, `${ROOM}/peer`);
    const mucsub = xml(
      'message',
      { from: ROOM },
      xml('event', {}, xml('items', {}, xml('item', {}, inner2)))
    );
    expect(await decryptStanzaInPlace(mucsub, DOMAIN)).toBe('decrypted');
    expect(inner2.getChildText('body')).toBe('once');
  });

  it('says so when the message was encrypted for other devices only', async () => {
    const pep: Pep = new Map();
    // Written before this device existed: there is no key for it inside.
    const peer = await Omemo.create(fakeClient(pep, PEER) as never, PEER, createMemoryStore());
    const third = await Omemo.create(fakeClient(pep, `third@${DOMAIN}`) as never, `third@${DOMAIN}`, createMemoryStore());
    const sent = await peer.encryptGroupMessage(ROOM, [PEER, third.jid], content('before you'), 'm-3', metadata());

    setE2eeEnabled(true);
    onOnline(fakeClient(pep, ME) as never);
    const stanza = overTheWire(sent, `${ROOM}/peer`);

    expect(await decryptStanzaInPlace(stanza, DOMAIN)).toBe('undecryptable');
    expect(stanza.getChildText('body')).toBe('Encrypted for another device');
    const data = stanza.getChild('data')!;
    // Still an encrypted message - not one "sent in clear".
    expect(data.attrs.omemoEncrypted).toBe('true');
    expect(data.attrs.undecryptable).toBe('true');
    expect(data.attrs.e2eeError).toBe('other-device');
    expect(data.attrs.senderFirstName).toBe('Peer');
  });

  it('marks a message it could not open, and never shows the sender fallback', async () => {
    await appAndPeer();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const stanza = xml(
      'message',
      { from: `${ROOM}/peer`, id: 'm-4' },
      xml(
        'encrypted',
        { xmlns: 'urn:xmpp:omemo:2' },
        xml('header', { sid: '1' }, xml('keys', { jid: ME }, xml('key', { rid: '1' }, 'AAAA'))),
        xml('payload', {}, 'ignored')
      ),
      xml('body', {}, 'fallback for clients without OMEMO')
    );
    expect(await decryptStanzaInPlace(stanza, DOMAIN)).toBe('undecryptable');
    warn.mockRestore();
    expect(stanza.getChildText('body')).not.toContain('fallback for clients');
    expect(stanza.getChild('data')!.attrs.omemoEncrypted).toBe('true');
    expect(stanza.getChild('data')!.attrs.e2eeError).toMatch(/^(failed|other-device)$/);
  });

  it('drops session maintenance and leaves plain messages alone', async () => {
    await appAndPeer();
    const empty = xml(
      'message',
      { from: `${ROOM}/peer` },
      xml('encrypted', { xmlns: 'urn:xmpp:omemo:2' }, xml('header', { sid: '1' }))
    );
    expect(await decryptStanzaInPlace(empty, DOMAIN)).toBe('drop');

    const plain = xml('message', { from: `${ROOM}/peer` }, xml('body', {}, 'hi'));
    expect(await decryptStanzaInPlace(plain, DOMAIN)).toBe('not-encrypted');
    expect(plain.getChildText('body')).toBe('hi');
    expect(plain.getChild('data')).toBeUndefined();
  });

  it('captions a closed payload by the reason it stayed closed', () => {
    expect(placeholderKey('unsupported')).toBe('e2ee.unsupportedMessage');
    expect(placeholderKey('other-device')).toBe('e2ee.otherDevice');
    expect(placeholderKey('failed')).toBe('e2ee.undecryptable');
    expect(placeholderKey(undefined)).toBe('e2ee.undecryptable');
  });
});

describe('writing', () => {
  const sendText = (client: any, room: string, text: string, id: string) =>
    sendTextMessage(client, room, 'Me', 'Myself', '', '0x1', text, '', false, false, '', 'wss://host/ws', id);

  it('encrypts the body in an encrypted room and keeps <data> readable', async () => {
    const { myClient, peer } = await appAndPeer();
    sendText(myClient, ROOM, 'for your eyes only', 'out-1');
    // Returns at once; the encrypted stanza follows.
    expect(myClient.sent).toHaveLength(0);
    await settle();
    await omemoReady().then((o) => o!.devices(ME));
    await settle();

    expect(myClient.sent).toHaveLength(1);
    const wire = myClient.sent[0]!;
    expect(wire.toString()).not.toContain('for your eyes only');
    // The id the optimistic bubble is matched by.
    expect(wire.attrs.id).toBe('out-1');
    expect(wire.attrs.to).toBe(ROOM);
    expect(wire.attrs.type).toBe('groupchat');
    expect(wire.getChild('encrypted', 'urn:xmpp:omemo:2')).toBeDefined();
    // What clients without OMEMO, and the push module, get to see.
    expect(wire.getChildText('body')).toBe('Encrypted message');
    expect(wire.getChild('data')!.attrs.senderFirstName).toBe('Me');
    expect(wire.getChild('data')!.attrs.push).toBe('true');

    const received = await peer!.decrypt(overTheWire(wire, `${ROOM}/me`), ME, ROOM);
    expect(received?.content).toBe('<body>for your eyes only</body>');

    // The room's echo of our own message reads back from the device cache.
    const echo = overTheWire(wire, `${ROOM}/me`);
    expect(await decryptStanzaInPlace(echo, DOMAIN)).toBe('decrypted');
    expect(echo.getChildText('body')).toBe('for your eyes only');
  });

  it('keeps the order of messages sent back to back', async () => {
    const { myClient, peer } = await appAndPeer();
    for (let i = 0; i < 4; i++) {sendText(myClient, ROOM, `n${i}`, `seq-${i}`);}
    await settle();
    await omemoReady().then((o) => o!.devices(ME));
    await settle();

    expect(myClient.sent.map((s) => s.attrs.id)).toEqual(['seq-0', 'seq-1', 'seq-2', 'seq-3']);
    for (let i = 0; i < 4; i++) {
      const got = await peer!.decrypt(overTheWire(myClient.sent[i]!, `${ROOM}/me`), ME, ROOM);
      expect(got?.content).toBe(`<body>n${i}</body>`);
    }
  });

  it('sends in clear when nobody in the room has a device, and says why', async () => {
    const { myClient } = await appAndPeer({ peerHasDevice: false });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    sendText(myClient, ROOM, 'nobody to encrypt for', 'out-2');
    await settle();
    await omemoReady().then((o) => o!.devices(ME));
    await settle();

    expect(myClient.sent).toHaveLength(1);
    const wire = myClient.sent[0]!;
    expect(wire.getChild('encrypted')).toBeUndefined();
    expect(wire.getChildText('body')).toBe('nobody to encrypt for');
    expect(wire.attrs.id).toBe('out-2');
    expect(String(warn.mock.calls[0]?.[0])).toContain('in clear');
    expect(String(warn.mock.calls[0]?.[0])).toContain('omemo_no_recipients');
    warn.mockRestore();

    // ...and the receiving side - ours included, on the echo - marks it.
    const message = await createMessageFromXml({
      data: { senderJID: ME },
      id: '1',
      body: 'nobody to encrypt for',
      roomJid: ROOM,
      date: '2026-10-05T10:00:00Z',
    } as any);
    expect(message.unencrypted).toBe(true);
  });

  it('leaves ordinary rooms exactly as they were', async () => {
    const { myClient } = await appAndPeer();
    sendText(myClient, PLAIN_ROOM, 'plain as ever', 'out-3');
    // Synchronously, as before.
    expect(myClient.sent).toHaveLength(1);
    expect(myClient.sent[0]!.getChildText('body')).toBe('plain as ever');
    expect(myClient.sent[0]!.getChild('encrypted')).toBeUndefined();
  });

  it('drops the translate tag in an encrypted room, encrypted or not', async () => {
    const { myClient, peer } = await appAndPeer();
    const message = (roomJID: string) => ({
      roomJID,
      firstName: 'Me',
      lastName: 'Myself',
      photo: '',
      walletAddress: '0x1',
      userMessage: 'bonjour',
      devServer: 'wss://host/ws',
    });

    expect(sendTextMessageWithTranslateTag(myClient as never, message(PLAIN_ROOM), 'fr' as never, 't-1')).toBe(true);
    expect(myClient.sent[0]!.getChild('translate')!.attrs.source).toBe('fr');

    expect(sendTextMessageWithTranslateTag(myClient as never, message(ROOM), 'fr' as never, 't-2')).toBe(true);
    await settle();
    await omemoReady().then((o) => o!.devices(ME));
    await settle();
    const wire = myClient.sent[1]!;
    expect(wire.attrs.id).toBe('t-2');
    expect(wire.getChild('translate')).toBeUndefined();
    expect(wire.toString()).not.toContain('bonjour');
    const got = await peer!.decrypt(overTheWire(wire, `${ROOM}/me`), ME, ROOM);
    expect(got?.content).toBe('<body>bonjour</body>');
  });

  it('addresses every member the backend lists, by account', () => {
    expect(roomRecipients(`${ROOM}/me`, DOMAIN)).toEqual([ME, PEER]);
    expect(roomRecipients('unknown@conference.localhost', DOMAIN)).toEqual([]);
  });

  it('asks the backend who is in a room whose members it does not have', async () => {
    const { myClient, peer } = await appAndPeer();
    mockHttpGet.mockResolvedValue({
      data: { result: { name: 'cached', members: [{ xmppUsername: 'me' }, { xmppUsername: 'peer' }] } },
    });

    sendText(myClient, CACHED_ROOM, 'after a cold start', 'cold-1');
    sendText(myClient, CACHED_ROOM, 'and another', 'cold-2');
    for (let i = 0; i < 5; i++) {await settle();}
    await omemoReady().then((o) => o!.devices(ME));
    await settle();

    // One request for both messages, which leave in the order written.
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
    expect(mockHttpGet.mock.calls[0]![0]).toBe('/v1/chats/my/cached');
    expect(myClient.sent.map((s) => s.attrs.id)).toEqual(['cold-1', 'cold-2']);
    const got = await peer!.decrypt(overTheWire(myClient.sent[0]!, `${CACHED_ROOM}/me`), ME, CACHED_ROOM);
    expect(got?.content).toBe('<body>after a cold start</body>');
  });

  it('sends nothing - not plaintext either - while it cannot learn who is in the room', async () => {
    const { myClient } = await appAndPeer();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttpGet.mockRejectedValue(new Error('network down'));

    // Encrypting with an empty member list would address the message to
    // our own devices alone: delivered, and unreadable by everyone else.
    await expect(resolveRecipients(CACHED_ROOM, DOMAIN)).rejects.toThrow('omemo_members_unknown');
    sendText(myClient, CACHED_ROOM, 'must not leak', 'cold-3');
    for (let i = 0; i < 5; i++) {await settle();}

    expect(myClient.sent).toHaveLength(0);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('not sending');
    warn.mockRestore();

    // A failed lookup is not remembered: the retry asks again.
    mockHttpGet.mockResolvedValue({ data: { members: [{ _id: 'peer' }, { xmppUsername: 'me' }] } });
    store.dispatch(setUser({ xmppUsername: 'app_me', token: 't' } as any));
    await expect(resolveRecipients(CACHED_ROOM, DOMAIN)).resolves.toEqual([
      `app_peer@${DOMAIN}`,
      ME,
    ]);
  });
});

describe('rooms from the backend', () => {
  it('keep the flag and the members of an encrypted room, and no roster otherwise', async () => {
    jest.useFakeTimers();
    store.dispatch(setUser({ xmppUsername: 'app_me', token: 'tok-rooms' } as any));
    clearRoomsRestCache();
    mockHttpGet.mockResolvedValue({
      data: {
        items: [
          {
            _id: '1',
            name: 'locked',
            jid: 'locked@conference.localhost',
            title: 'Locked',
            type: 'private',
            e2ee: true,
            members: [
              { _id: 'me', firstName: 'Me', xmppUsername: 'app_me' },
              // No xmppUsername from the API: derived from the app id.
              { _id: 'peer', firstName: 'Peer' },
            ],
          },
          {
            _id: '2',
            name: 'open',
            jid: 'open@conference.localhost',
            title: 'Open',
            type: 'public',
            e2ee: false,
            members: [{ _id: 'me', xmppUsername: 'app_me' }],
          },
        ],
      },
    });
    await getRooms();
    jest.clearAllTimers();
    jest.useRealTimers();

    const rooms = store.getState().rooms.rooms;
    expect(rooms['locked@conference.localhost']!.e2ee).toBe(true);
    expect(roomRecipients('locked@conference.localhost', DOMAIN)).toEqual([
      `app_me@${DOMAIN}`,
      `app_peer@${DOMAIN}`,
    ]);
    expect(rooms['open@conference.localhost']!.e2ee).toBeUndefined();
    expect(rooms['open@conference.localhost']!.members).toBeUndefined();
  });
});

describe('starting an encrypted chat', () => {
  it('asks for the encrypted room of the pair, and only when told to', async () => {
    mockHttpPost.mockResolvedValue({ data: { result: { name: 'pair', e2ee: true } } });
    await expect(postPrivateRoom('u2', true)).resolves.toEqual({ name: 'pair', e2ee: true });
    expect(mockHttpPost.mock.calls[0]![1]).toEqual({ username: 'u2', e2ee: true });

    // A backend that predates the field rejects unknown keys: the plain
    // request must stay byte-identical to what it always was.
    await postPrivateRoom('u2');
    expect(mockHttpPost.mock.calls[1]![1]).toEqual({ username: 'u2' });
    // The second argument used to be a title string.
    await postPrivateRoom('u2', 'Private chat' as never);
    expect(mockHttpPost.mock.calls[2]![1]).toEqual({ username: 'u2' });
  });
});

describe('sealed attachments on the wire', () => {
  const payload = (roomJid: string, keys?: string[]) => ({
    firstName: 'Me',
    lastName: 'Myself',
    walletAddress: '0x1',
    fileName: 'f3a9',
    location: 'https://files.host/f3a9',
    locationPreview: '',
    mimetype: 'application/octet-stream',
    originalName: 'f3a9',
    size: 1234,
    roomJid,
    e2eeKeys: keys,
  });

  it('sends the keys inside the encrypted body, and nothing telling beside it', async () => {
    const { myClient, peer } = await appAndPeer();
    sendMediaMessage(myClient as never, ROOM, payload(ROOM, ['KEY-ONE']), 'media-1', 'wss://host/ws');
    expect(myClient.sent).toHaveLength(0);
    await settle();
    await omemoReady().then((o) => o!.devices(ME));
    await settle();

    const wire = myClient.sent[0]!;
    expect(wire.attrs.id).toBe('media-1');
    expect(wire.toString()).not.toContain('KEY-ONE');
    const data = wire.getChild('data')!;
    expect(data.attrs.clientEncrypted).toBe('true');
    expect(data.attrs.isMediafile).toBe('true');
    expect(data.attrs.mimetype).toBe('application/octet-stream');
    expect(data.attrs.e2eeKeys).toBeUndefined();
    expect(wire.getChild('store', 'urn:xmpp:hints')).toBeDefined();

    // The other side: decrypt, parse, and the key is where the card reads it.
    const received = overTheWire(wire, `${ROOM}/me`);
    const got = await peer!.decrypt(received, ME, ROOM);
    expect(got?.content).toBe('<body>{"v":1,"keys":["KEY-ONE"]}</body>');

    // And our own echo, through the same seam every message takes.
    const echo = overTheWire(wire, `${ROOM}/me`);
    expect(await decryptStanzaInPlace(echo, DOMAIN)).toBe('decrypted');
    const message = await createMessageFromXml({
      data: echo.getChild('data')!.attrs,
      id: '1',
      body: echo.getChildText('body'),
      roomJid: ROOM,
      date: '2026-10-05T10:00:00Z',
    } as any);
    expect(message.e2eeKeys).toEqual(['KEY-ONE']);
    expect(message.body).toBe('media');
    expect(message.unencrypted).toBeUndefined();
  });

  it('sends nothing when it cannot encrypt - the keys never go out in clear', async () => {
    const { myClient } = await appAndPeer({ peerHasDevice: false });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    sendMediaMessage(myClient as never, ROOM, payload(ROOM, ['KEY-TWO']), 'media-2', 'wss://host/ws');
    for (let i = 0; i < 5; i++) {await settle();}
    expect(myClient.sent).toHaveLength(0);
    expect(String(error.mock.calls[0]?.[0])).toContain('refusing to send sealed attachment');
    error.mockRestore();
  });

  it('leaves ordinary media exactly as it was', async () => {
    const { myClient } = await appAndPeer();
    sendMediaMessage(myClient as never, PLAIN_ROOM, payload(PLAIN_ROOM), 'media-3', 'wss://host/ws');
    expect(myClient.sent).toHaveLength(1);
    const wire = myClient.sent[0]!;
    expect(wire.getChildText('body')).toBe('media');
    expect(wire.getChild('data')!.attrs.clientEncrypted).toBeUndefined();
    expect(wire.getChild('encrypted')).toBeUndefined();
  });
});

describe('what may be sent where', () => {
  it('follows the flag, for text and attachments alike', async () => {
    expect(canSendToRoom(ROOM)).toBe(false);
    expect(canSendToRoom(PLAIN_ROOM)).toBe(true);
    setE2eeEnabled(true);
    expect(canSendToRoom(ROOM)).toBe(true);
    expect(canSendToRoom(PLAIN_ROOM)).toBe(true);
    // Attachments follow the same rule: sealed when on, refused when off.
    expect(canSendMediaToRoom(ROOM)).toBe(true);
    expect(canSendMediaToRoom(PLAIN_ROOM)).toBe(true);
    setE2eeEnabled(false);
    expect(canSendMediaToRoom(ROOM)).toBe(false);
    expect(canSendMediaToRoom(PLAIN_ROOM)).toBe(true);
  });
});

describe('sealed attachments in a decrypted message', () => {
  it('lifts the keys out of the body', async () => {
    expect(parseSealedMediaBody('{"v":1,"keys":["a","b"]}')).toEqual(['a', 'b']);
    expect(parseSealedMediaBody('media')).toBeUndefined();
    expect(parseSealedMediaBody('{"v":2,"keys":["a"]}')).toBeUndefined();
    expect(parseSealedMediaBody('{"v":1,"keys":["a",""]}')).toBeUndefined();
    expect(parseSealedMediaBody('{not json')).toBeUndefined();

    const message = await createMessageFromXml({
      data: { senderJID: PEER, clientEncrypted: 'true', omemoEncrypted: 'true', isMediafile: 'true' },
      id: '9',
      body: '{"v":1,"keys":["k1"]}',
      roomJid: ROOM,
      date: '2026-10-05T10:00:00Z',
    } as any);
    expect(message.e2eeKeys).toEqual(['k1']);
    // Nothing downstream may render the key JSON as message text.
    expect(message.body).toBe('media');

    // Undecrypted: the placeholder body stays, and there are no keys.
    const closed = await createMessageFromXml({
      data: { senderJID: PEER, clientEncrypted: 'true', undecryptable: 'true' },
      id: '10',
      body: 'Encrypted for another device',
      roomJid: ROOM,
      date: '2026-10-05T10:00:00Z',
    } as any);
    expect(closed.e2eeKeys).toBeUndefined();
    expect(closed.body).toBe('Encrypted for another device');
  });
});
