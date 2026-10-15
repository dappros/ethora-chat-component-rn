/**
 * Receipt stanzas on the wire: incoming receipts and markers update the
 * store (and never become messages), a live message from someone else is
 * acked, our own echo and system messages are not, and a MAM page acks what
 * it brings in (windowed queries excluded).
 */

jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const roomsReducer = require('../src/roomStore/roomsSlice').default;
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const _store = configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });
  return { __esModule: true, store: _store };
});

import { parse } from 'ltx';
import { xml } from '@xmpp/client';
import { store } from '../src/roomStore';
import {
  addRoom,
  deleteAllRooms,
  setRoomMessages,
} from '../src/roomStore/roomsSlice';
import { setUser } from '../src/roomStore/chatSettingsSlice';
import {
  isReceiptMarkerStanza,
  onDisplayedMarker,
  onMessageHistory,
  onRealtimeMessage,
  onReceivedReceipt,
} from '../src/networking/stanzaHandlers';
import { __resetMamRouter } from '../src/networking/xmpp/mamRouter';
import type { IMessage, IRoom } from '../src/types/types';

const ROOM = 'room@conference.example.com';
const ME = 'me_user';
const THEM = 'them_user';
const MSG_ID = '1700000000001';

const makeClient = () => ({
  sendReceivedReceiptStanza: jest.fn(),
  sendDisplayedMarkerStanza: jest.fn(),
});

const roomState = () => store.getState().rooms.rooms[ROOM];
const bodies = () => (roomState()?.messages || []).map((m: IMessage) => m.body);

beforeEach(() => {
  __resetMamRouter();
  store.dispatch(deleteAllRooms());
  store.dispatch(
    addRoom({
      roomData: { jid: ROOM, name: 'room', title: 'room', messages: [] } as unknown as IRoom,
    })
  );
  store.dispatch(setUser({ xmppUsername: ME, walletAddress: 'wallet-me' } as any));
});

const liveMessage = (from: string, body: string, extra: Record<string, string> = {}) =>
  xml(
    'message',
    { type: 'groupchat', from: `${ROOM}/${from}`, id: `live-${body}` },
    xml('data', { senderJID: `${from}@example.com`, senderFirstName: 'F', senderLastName: 'L', ...extra }),
    xml('body', {}, body)
  );

const receiptFrame = (targetId: string, sender: string) =>
  parse(
    `<message type="groupchat" from="${ROOM}/${sender}" id="message-received:1700000000009">
       <received xmlns="urn:xmpp:receipts" id="${targetId}" from="${sender}@xmpp.example.com/web-1"/>
       <store xmlns="urn:xmpp:hints"/>
     </message>`
  );

const displayedFrame = (targetId: string, sender: string) =>
  parse(
    `<message type="groupchat" from="${ROOM}/${sender}" id="message-displayed:1700000000010">
       <displayed xmlns="urn:xmpp:chat-markers:0" id="${targetId}" from="${sender}@xmpp.example.com/web-1"/>
       <store xmlns="urn:xmpp:hints"/>
     </message>`
  );

const mamRow = (
  queryId: string,
  archiveId: string,
  from: string,
  body: string
) =>
  parse(
    `<message from="${ROOM}" to="me@example.com">
       <result xmlns="urn:xmpp:mam:2" queryid="${queryId}" id="${archiveId}">
         <forwarded xmlns="urn:xmpp:forward:0">
           <delay xmlns="urn:xmpp:delay" stamp="2026-10-14T08:39:00.000Z"/>
           <message from="${ROOM}/${from}" id="orig-${archiveId}" type="groupchat">
             <stanza-id xmlns="urn:xmpp:sid:0" by="${ROOM}" id="${archiveId}"/>
             <data senderJID="${from}@example.com" senderFirstName="A" senderLastName="B"/>
             <body>${body}</body>
           </message>
         </forwarded>
       </result>
     </message>`
  );

const mamMarkerRow = (queryId: string, archiveId: string, from: string) =>
  parse(
    `<message from="${ROOM}" to="me@example.com">
       <result xmlns="urn:xmpp:mam:2" queryid="${queryId}" id="${archiveId}">
         <forwarded xmlns="urn:xmpp:forward:0">
           <delay xmlns="urn:xmpp:delay" stamp="2026-10-14T08:40:00.000Z"/>
           <message from="${ROOM}/${from}" id="message-displayed:${archiveId}" type="groupchat">
             <displayed xmlns="urn:xmpp:chat-markers:0" id="${MSG_ID}" from="${from}@example.com"/>
             <store xmlns="urn:xmpp:hints"/>
           </message>
         </forwarded>
       </result>
     </message>`
  );

describe('isReceiptMarkerStanza', () => {
  it('matches the id prefixes and the receipt / marker children', () => {
    expect(isReceiptMarkerStanza(receiptFrame(MSG_ID, THEM))).toBe(true);
    expect(isReceiptMarkerStanza(displayedFrame(MSG_ID, THEM))).toBe(true);
    expect(isReceiptMarkerStanza(liveMessage(THEM, 'hi'))).toBe(false);
  });
});

describe('incoming receipts and markers', () => {
  beforeEach(() => {
    store.dispatch(
      setRoomMessages({
        roomJID: ROOM,
        messages: [
          { id: MSG_ID, body: 'mine', date: new Date().toISOString(), roomJid: ROOM, user: { id: ME, name: ME } } as unknown as IMessage,
        ],
      })
    );
  });

  it('a receipt marks the message delivered to that occupant', () => {
    onReceivedReceipt(receiptFrame(MSG_ID, THEM) as any);
    const m = roomState().messages[0] as IMessage;
    expect(Object.keys(m.receivedBy || {})).toEqual([THEM]);
  });

  it('a receipt for an unknown message id changes nothing', () => {
    onReceivedReceipt(receiptFrame('nope', THEM) as any);
    expect(roomState().messages[0].receivedBy).toBeUndefined();
  });

  it('a displayed marker sets the reader watermark for the room', () => {
    onDisplayedMarker(displayedFrame(MSG_ID, THEM) as any);
    expect(roomState().lastDisplayedByUser).toEqual({ [THEM]: MSG_ID });
  });

  it('ignores a frame whose id is not a receipt or marker, and one without its child', () => {
    const notReceipt = parse(
      `<message type="groupchat" from="${ROOM}/${THEM}" id="other:1"><received xmlns="urn:xmpp:receipts" id="${MSG_ID}" from="${THEM}@h"/></message>`
    );
    onReceivedReceipt(notReceipt as any);
    const noChild = parse(
      `<message type="groupchat" from="${ROOM}/${THEM}" id="message-displayed:1"/>`
    );
    onDisplayedMarker(noChild as any);
    expect(roomState().messages[0].receivedBy).toBeUndefined();
    expect(roomState().lastDisplayedByUser).toBeUndefined();
  });

  it('a receipt or marker never becomes a chat message, nor counts as unread', async () => {
    const before = bodies();
    const unreadBefore = roomState().unreadMessages;
    const client = makeClient();
    const result = await onRealtimeMessage(receiptFrame(MSG_ID, THEM) as any, client as any);
    await onRealtimeMessage(displayedFrame(MSG_ID, THEM) as any, client as any);
    expect(result).toBeUndefined();
    expect(bodies()).toEqual(before);
    expect(roomState().unreadMessages).toBe(unreadBefore);
    expect(client.sendReceivedReceiptStanza).not.toHaveBeenCalled();
  });
});

describe('acknowledging live messages', () => {
  it('acks a live message from someone else with the stored message id', async () => {
    const client = makeClient();
    await onRealtimeMessage(liveMessage(THEM, 'hello there') as any, client as any);
    const stored = roomState().messages.find((m: IMessage) => m.body === 'hello there') as IMessage;
    expect(stored).toBeDefined();
    expect(client.sendReceivedReceiptStanza).toHaveBeenCalledTimes(1);
    expect(client.sendReceivedReceiptStanza).toHaveBeenCalledWith(String(stored.id), ROOM);
  });

  it('does not ack our own echo', async () => {
    const client = makeClient();
    await onRealtimeMessage(liveMessage(ME, 'my own echo') as any, client as any);
    expect(bodies()).toContain('my own echo');
    expect(client.sendReceivedReceiptStanza).not.toHaveBeenCalled();
  });

  it('does not ack a system message', async () => {
    const client = makeClient();
    await onRealtimeMessage(
      liveMessage(THEM, 'room notice', { isSystemMessage: 'true' }) as any,
      client as any
    );
    expect(bodies()).toContain('room notice');
    expect(client.sendReceivedReceiptStanza).not.toHaveBeenCalled();
  });

  it('keeps working without a client handle (no crash, no ack)', async () => {
    await onRealtimeMessage(liveMessage(THEM, 'no client') as any);
    expect(bodies()).toContain('no client');
  });
});

describe('acknowledging messages fetched by MAM catch-up', () => {
  it('acks a fetched message from someone else', async () => {
    const client = makeClient();
    await onMessageHistory(mamRow('get-history:1', '1700000000100', THEM, 'old one') as any, client as any);
    expect(bodies()).toContain('old one');
    expect(client.sendReceivedReceiptStanza).toHaveBeenCalledWith('1700000000100', ROOM);
  });

  it('does not ack our own fetched message', async () => {
    const client = makeClient();
    await onMessageHistory(mamRow('get-history:2', '1700000000101', ME, 'mine old') as any, client as any);
    expect(client.sendReceivedReceiptStanza).not.toHaveBeenCalled();
  });

  it('never acks rows of a windowed query (jump window)', async () => {
    const client = makeClient();
    await onMessageHistory(mamRow('window:abc', '1700000000102', THEM, 'window row') as any, client as any);
    expect(client.sendReceivedReceiptStanza).not.toHaveBeenCalled();
    expect(bodies()).not.toContain('window row');
  });

  it('a MAM page of only archived markers adds no message and acks nothing', async () => {
    const client = makeClient();
    await onMessageHistory(mamMarkerRow('get-history:3', '1700000000103', THEM) as any, client as any);
    await onMessageHistory(
      parse(
        `<message from="${ROOM}" to="me@example.com"><result xmlns="urn:xmpp:mam:2" queryid="get-history:3" id="1700000000104"><forwarded xmlns="urn:xmpp:forward:0"><delay xmlns="urn:xmpp:delay" stamp="2026-10-14T08:41:00.000Z"/><message from="${ROOM}/${THEM}" id="message-received:1700000000104" type="groupchat"><received xmlns="urn:xmpp:receipts" id="${MSG_ID}" from="${THEM}@example.com"/></message></forwarded></result></message>`
      ) as any,
      client as any
    );
    expect(roomState()?.messages || []).toHaveLength(0);
    expect(client.sendReceivedReceiptStanza).not.toHaveBeenCalled();
  });
});
