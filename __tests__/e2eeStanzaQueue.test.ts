/**
 * E2EE, phase 3 - the order of stanzas around a message being decrypted.
 *
 * Decrypting takes a moment, and handleStanza is called synchronously for
 * each stanza off the wire. Without a queue, whatever arrives while a
 * message is being decrypted overtakes it: the closing <iq> of an archive
 * page is routed before the page's messages (so the page is applied without
 * them), and an edit before the message it edits.
 */

jest.mock('../src/e2ee/deviceStore', () => {
  const { createMemoryBackend, createStore } = jest.requireActual('../src/e2ee/store');
  const backend = createMemoryBackend();
  return { openDeviceStore: async (jid: string) => createStore(backend, jid) };
});

const mockOrder: string[] = [];
jest.mock('../src/networking/stanzaHandlers', () => {
  const noop = () => jest.fn();
  return {
    onDeleteMessage: noop(),
    onEditMessage: noop(),
    onRealtimeMessage: jest.fn((stanza: any) => {
      if (stanza.name === 'message') {
        mockOrder.push(`message:${stanza.attrs.id}:${stanza.getChildText('body')}`);
      }
    }),
    onMessageHistory: noop(),
    onGetLastMessageArchive: noop(),
    handleComposing: noop(),
    onChatInvite: noop(),
    onPresenceInRoom: noop(),
    onGetChatRooms: jest.fn((stanza: any) => mockOrder.push(`iq:${stanza.attrs.id}`)),
    onGetMembers: noop(),
    onGetRoomInfo: noop(),
    onNewRoomCreated: noop(),
    onReactionMessage: noop(),
    onReactionHistory: noop(),
    onRoomKicked: noop(),
    onMessageError: noop(),
  };
});

import { xml } from '@xmpp/client';
import { Element } from 'ltx';
import { fakeClient, type Pep } from './fixtures/fakePep';
import { Omemo } from '../src/e2ee/omemo';
import { createMemoryStore } from '../src/e2ee/store';
import { __resetE2eeForTests, omemoReady, onOnline, setE2eeEnabled } from '../src/e2ee';
import {
  __resetStanzaQueueForTests,
  handleStanza,
} from '../src/networking/xmpp/handleStanzas.xmpp';

const DOMAIN = 'localhost';
const ROOM = 'secret@conference.localhost';
const ME = `me@${DOMAIN}`;
const PEER = `peer@${DOMAIN}`;

const overTheWire = (stanza: Element, from: string) => {
  const copy = require('ltx').parse(stanza.toString()) as Element;
  copy.attrs.from = from;
  return copy;
};
const drain = async () => {
  for (let i = 0; i < 20; i++) {await new Promise((resolve) => setTimeout(resolve, 0));}
};

let ws: any;
let peer: Omemo;
let n = 0;
const encrypted = async (text: string) => {
  const id = `e-${++n}`;
  const sent = await peer.encryptGroupMessage(ROOM, [ME, PEER], [xml('body', {}, text)], id, [
    xml('data', { senderJID: PEER }),
  ]);
  return overTheWire(sent, `${ROOM}/peer`);
};
const plain = (id: string, text: string) =>
  xml('message', { from: `${ROOM}/peer`, id }, xml('data', { senderJID: PEER }), xml('body', {}, text));
const iq = (id: string) => xml('iq', { type: 'result', id });

beforeEach(async () => {
  mockOrder.length = 0;
  __resetE2eeForTests();
  __resetStanzaQueueForTests();
  const pep: Pep = new Map();
  const client = fakeClient(pep, ME);
  ws = { client, username: 'me' };
  onOnline(client as never);
  peer = await Omemo.create(fakeClient(pep, PEER) as never, PEER, createMemoryStore());
});
afterAll(() => __resetE2eeForTests());

const start = async () => {
  setE2eeEnabled(true);
  await (await omemoReady())!.published();
};

it('dispatches synchronously while nothing is being decrypted', async () => {
  await start();
  handleStanza(plain('p-1', 'one'), ws);
  handleStanza(iq('q-1'), ws);
  expect(mockOrder).toEqual(['message:p-1:one', 'iq:q-1']);
});

it('holds what arrives behind a message that is being decrypted', async () => {
  await start();
  const first = await encrypted('first');
  const second = await encrypted('second');

  handleStanza(first, ws);
  handleStanza(plain('p-2', 'plain in between'), ws);
  handleStanza(second, ws);
  handleStanza(iq('page-closed'), ws);
  // Nothing overtook the encrypted message.
  expect(mockOrder).toEqual([]);

  await drain();
  expect(mockOrder).toEqual([
    'message:e-1:first',
    'message:p-2:plain in between',
    'message:e-2:second',
    'iq:page-closed',
  ]);

  // The queue is empty again: back to synchronous dispatch.
  handleStanza(iq('q-2'), ws);
  expect(mockOrder[mockOrder.length - 1]).toBe('iq:q-2');
});

it('keeps an archive page together: messages first, the closing iq last', async () => {
  await start();
  const page = [];
  for (const text of ['a', 'b', 'c']) {
    const inner = await encrypted(text);
    page.push(
      xml(
        'message',
        { from: ROOM, id: `wrap-${inner.attrs.id}` },
        xml('result', { xmlns: 'urn:xmpp:mam:2', id: inner.attrs.id }, xml('forwarded', {}, inner))
      )
    );
  }
  const seen: string[] = [];
  const handlers = jest.requireMock('../src/networking/stanzaHandlers');
  handlers.onMessageHistory.mockImplementation((stanza: any) => {
    const inner = stanza.getChild('result')?.getChild('forwarded')?.getChild('message');
    if (inner) {seen.push(inner.getChildText('body'));}
  });
  handlers.onGetChatRooms.mockImplementationOnce(() => seen.push('<closing iq>'));

  for (const stanza of page) {handleStanza(stanza, ws);}
  handleStanza(iq('mam-fin'), ws);
  await drain();
  handlers.onMessageHistory.mockReset();

  expect(seen).toEqual(['a', 'b', 'c', '<closing iq>']);
});

it('does not dispatch session maintenance, and a failure does not block the queue', async () => {
  await start();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const empty = xml(
    'message',
    { from: `${ROOM}/peer`, id: 'empty' },
    xml('encrypted', { xmlns: 'urn:xmpp:omemo:2' }, xml('header', { sid: '1' }))
  );
  const broken = xml(
    'message',
    { from: `${ROOM}/peer`, id: 'broken' },
    xml('encrypted', { xmlns: 'urn:xmpp:omemo:2' }, xml('header', {}), xml('payload', {}, '!!')),
    xml('data', { senderJID: PEER })
  );
  handleStanza(empty, ws);
  handleStanza(broken, ws);
  handleStanza(plain('p-3', 'after'), ws);
  await drain();
  warn.mockRestore();

  expect(mockOrder).toEqual([
    'message:broken:Could not decrypt this message',
    'message:p-3:after',
  ]);
});

it('with encryption off, rewrites to a placeholder at once and queues nothing', async () => {
  // This app has no device, so nobody can have encrypted for it: the
  // message is one written for the room's other members.
  const stanza = xml(
    'message',
    { from: `${ROOM}/peer`, id: 'off-1' },
    xml(
      'encrypted',
      { xmlns: 'urn:xmpp:omemo:2' },
      xml('header', { sid: '5' }, xml('keys', { jid: PEER }, xml('key', { rid: '6' }, 'AAAA'))),
      xml('payload', {}, 'AAAA')
    ),
    xml('body', {}, 'Encrypted message'),
    xml('data', { senderJID: PEER })
  );
  handleStanza(stanza, ws);
  handleStanza(iq('q-3'), ws);
  expect(mockOrder).toEqual([
    "message:off-1:Encrypted message. This version of the app can't read it yet.",
    'iq:q-3',
  ]);
  expect(stanza.getChild('data')!.attrs.e2eeError).toBe('unsupported');
});
