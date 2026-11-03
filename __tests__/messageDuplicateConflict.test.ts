/**
 * Server dedup answer: when ejabberd's mod_message_dedup drops a resent
 * copy (reconnect replay or retry tap) it answers the sender with
 * `<message type="error" id="same id"><error><conflict/></error></message>`.
 * The copy it kept is the delivered one, so the client must flip its
 * bubble to delivered and clear any "Failed" state. Otherwise a message
 * whose first echo was lost with the old session stays "Failed" for good
 * and every retry is dropped again in silence.
 */
import { parse } from 'ltx';
import { store } from '../src/roomStore';
import { addRoom, addRoomMessage, deleteAllRooms } from '../src/roomStore/roomsSlice';
import { clearMessageFailure, markMessageFailed } from '../src/roomStore/roomHeapSlice';
import {
  clearOutboundSends,
  enqueueOutboundSend,
  hasSendsAwaitingEcho,
  outboundQueueLength,
} from '../src/networking/outboundQueue';
import { handleStanza } from '../src/networking/xmpp/handleStanzas.xmpp';

const ROOM = 'general@conference.xmpp.example';
const ID = 'send-text-message-1-1';

const conflict = (id = ID, condition = 'conflict', from = ROOM) =>
  parse(
    `<message xmlns="jabber:client" type="error" id="${id}" from="${from}" to="u@xmpp.example/res">` +
      `<error type="cancel"><${condition} xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>` +
      '<text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas">Duplicate message: already received</text>' +
      '</error></message>'
  ) as any;

const fakeXmpp = { username: 'u', client: {} } as any;

const message = () =>
  store.getState().rooms.rooms[ROOM]?.messages?.find((m: any) => m.id === ID) as any;

beforeEach(() => {
  clearOutboundSends();
  store.dispatch(deleteAllRooms());
  store.dispatch(clearMessageFailure(ID));
  store.dispatch(
    addRoom({
      roomData: {
        jid: ROOM,
        id: ROOM,
        name: 'general',
        title: 'general',
        usersCnt: 1,
        messages: [],
        isLoading: false,
        roomBg: null,
      } as any,
    })
  );
  store.dispatch(
    addRoomMessage({
      roomJID: ROOM,
      message: {
        id: ID,
        xmppId: ID,
        body: 'hi',
        roomJid: ROOM,
        date: new Date().toISOString(),
        pending: true,
        user: { id: 'u', name: 'U' },
      } as any,
    })
  );
  enqueueOutboundSend({
    optimisticId: ID,
    roomJID: ROOM,
    enqueuedAt: Date.now(),
    send: jest.fn(),
  });
});

describe('conflict error from the server dedup', () => {
  it('marks a pending message delivered', () => {
    expect(message().pending).toBe(true);
    handleStanza(conflict(), fakeXmpp);
    expect(message().pending).toBe(false);
    expect(outboundQueueLength()).toBe(0);
    expect(hasSendsAwaitingEcho()).toBe(false);
  });

  it('clears the "Failed" state of a message the watchdog gave up on', () => {
    store.dispatch(
      markMessageFailed({ kind: 'text', id: ID, roomJID: ROOM, body: 'hi' } as any)
    );
    expect(store.getState().roomHeapSlice.failedMessages[ID]).toBeTruthy();
    handleStanza(conflict(), fakeXmpp);
    expect(store.getState().roomHeapSlice.failedMessages[ID]).toBeUndefined();
    expect(message().pending).toBe(false);
  });

  it('ignores other message errors', () => {
    handleStanza(conflict(ID, 'not-acceptable'), fakeXmpp);
    expect(message().pending).toBe(true);
    expect(outboundQueueLength()).toBe(1);
  });

  it('ignores a conflict for an id it does not know', () => {
    handleStanza(conflict('someone-else'), fakeXmpp);
    expect(message().pending).toBe(true);
    expect(outboundQueueLength()).toBe(1);
  });

  it('does not add anything to the room', () => {
    const before = store.getState().rooms.rooms[ROOM].messages.length;
    handleStanza(conflict(), fakeXmpp);
    expect(store.getState().rooms.rooms[ROOM].messages.length).toBe(before);
  });
});
