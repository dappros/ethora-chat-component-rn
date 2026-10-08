/**
 * Outgoing <data> no longer carries isSystemMessage="false". Every reader
 * checks only === 'true', so the attribute was redundant bytes per message.
 * 'true' still marks real system messages.
 */
import { sendTextMessage } from '../src/networking/xmpp/sendTextMessage.xmpp';
import { sendTextMessageWithTranslateTag } from '../src/networking/xmpp/sendTextMessageWithTranslateTag.xmpp';
import { sendMediaMessage } from '../src/networking/xmpp/sendMediaMessage.xmpp';
import { buildLocalCallLogMessage } from '../src/helpers/callLogMessage';
import roomsReducer, { addRoomFromApi, addRoomMessage } from '../src/roomStore/roomsSlice';
import { unreadMiddleware } from '../src/roomStore/Middleware/unreadMidlleware';
import { configureStore } from '@reduxjs/toolkit';
import { createRoomFromApi } from '../src/helpers/createRoomFromApi';

const ROOM_JID = 'room@conference.xmpp.example';

const makeClient = () => {
  const client: any = {
    jid: { toString: () => 'user@xmpp.example/web' },
    options: { service: 'wss://xmpp.example/ws' },
    send: jest.fn(async () => undefined),
  };
  return client;
};
const sentXml = (client: any) => client.send.mock.calls[0][0].toString() as string;

describe('outgoing stanzas omit isSystemMessage', () => {
  it('text message', () => {
    const client = makeClient();
    sendTextMessage(client, ROOM_JID, 'Ada', 'L', '', '0x1', 'hi');
    expect(sentXml(client)).toContain('<data');
    expect(sentXml(client)).not.toContain('isSystemMessage');
  });

  it('text message with translate tag', () => {
    const client = makeClient();
    sendTextMessageWithTranslateTag(client, {
      roomJID: ROOM_JID,
      firstName: 'Ada',
      lastName: 'L',
      photo: '',
      walletAddress: '0x1',
      userMessage: 'hi',
      langSource: 'en',
    } as any);
    expect(client.send).toHaveBeenCalled();
    expect(sentXml(client)).not.toContain('isSystemMessage');
  });

  it('media message', () => {
    const client = makeClient();
    sendMediaMessage(client, ROOM_JID, { firstName: 'Ada', lastName: 'L', location: 'x', mimetype: 'a/b' }, 'id-1');
    expect(sentXml(client)).not.toContain('isSystemMessage');
  });

  it('call-log system message still carries true', () => {
    const m = buildLocalCallLogMessage({
      callId: 'c1',
      direction: 'outgoing',
      durationMs: 1000,
      kind: 'audio',
      selfXmppUsername: 'me',
    } as any);
    expect((m as any).isSystemMessage).toBe('true');
  });
});

describe('unread counting tolerates absent / false isSystemMessage', () => {
  const JID = 'app_room1@conference.example.com';
  const msg = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      body: id,
      date: new Date(Date.now() + 10).toISOString(),
      roomJid: JID,
      user: { id: 'peer', name: 'peer' },
      ...extra,
    }) as any;
  const setup = () => {
    const store = configureStore({
      reducer: { rooms: roomsReducer } as any,
      middleware: (g) => g({ serializableCheck: false, immutableCheck: false }).concat(unreadMiddleware),
    });
    store.dispatch(
      addRoomFromApi({
        room: createRoomFromApi({ name: 'app_room1', type: 'group', title: 'R' } as any, 'conference.example.com') as any,
      })
    );
    // a read baseline, so new messages count as unread
    store.dispatch({ type: 'roomMessages/setLastViewedTimestamp', payload: { chatJID: JID, timestamp: Date.now() - 1000 } });
    return store;
  };
  const unread = (s: any) => s.getState().rooms.rooms[JID].unreadMessages;

  it('absent field counts as a normal unread message', () => {
    const s = setup();
    s.dispatch(addRoomMessage({ roomJID: JID, message: msg('a') }));
    expect(unread(s)).toBe(1);
  });
  it("legacy 'false' still counts", () => {
    const s = setup();
    s.dispatch(addRoomMessage({ roomJID: JID, message: msg('b', { isSystemMessage: 'false' }) }));
    expect(unread(s)).toBe(1);
  });
  it("'true' does not count", () => {
    const s = setup();
    s.dispatch(addRoomMessage({ roomJID: JID, message: msg('c', { isSystemMessage: 'true' }) }));
    expect(unread(s)).toBe(0);
  });
});
