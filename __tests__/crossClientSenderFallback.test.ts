/**
 * onRealtimeMessage / onMessageHistory — cross-client sender fallback.
 *
 * Regression for a real captured wire message: the web SDK's
 * translate-tagged send path builds `<data>` from a differently-named
 * attr bag (roomJID/firstName/userMessage/…) that carries NO `senderJID`
 * at all — e.g.
 *
 *   <data roomJID="…" firstName="John" lastName="test_upd" userMessage="…"
 *         devServer="…" push="true"/><body>…</body><translate source="es"/>
 *
 * Both handlers used to hard-require `data.attrs.senderJID` (history also
 * required senderFirstName/senderLastName) and silently drop the message
 * otherwise — live AND in the MAM backfill, so it never appeared even
 * after restarting the app. They must now fall back to the stanza's own
 * `from` (the full MUC occupant jid, exactly what senderJID would have
 * held) instead of dropping the message.
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

import { xml } from '@xmpp/client';
import { store } from '../src/roomStore';
import { addRoom } from '../src/roomStore/roomsSlice';
import { onRealtimeMessage, onMessageHistory } from '../src/networking/stanzaHandlers';

const ROOM = 'room@conference.h';
const OCCUPANT_FROM = `${ROOM}/John`;

beforeEach(() => {
  store.dispatch(
    addRoom({
      roomData: { jid: ROOM, name: 'room', messages: [] } as any,
    })
  );
});

describe('onRealtimeMessage — sender fallback for data without senderJID', () => {
  it('accepts a live message whose <data> has no senderJID, using stanza `from` instead', async () => {
    const stanza = xml(
      'message',
      { type: 'groupchat', from: OCCUPANT_FROM, id: 'send-translate-message-1' },
      xml('data', {
        roomJID: ROOM,
        firstName: 'John',
        lastName: 'test_upd',
        userMessage: 'Spanish to translate',
        devServer: 'wss://h/ws',
        push: 'true',
        // no senderJID, no senderFirstName/senderLastName
      }),
      xml('body', {}, 'Spanish to translate')
    );

    await onRealtimeMessage(stanza as any);

    const room = store.getState().rooms.rooms[ROOM];
    expect(room.messages.some((m: any) => m.body === 'Spanish to translate')).toBe(true);
    const msg = room.messages.find((m: any) => m.body === 'Spanish to translate');
    // Falls back to the occupant jid derived from stanza `from`.
    expect(msg.user.id).toContain('John');
  });

  it('still drops a message with no <data> element at all', async () => {
    const stanza = xml(
      'message',
      { type: 'groupchat', from: OCCUPANT_FROM, id: 'no-data-1' },
      xml('body', {}, 'should be dropped')
    );
    await onRealtimeMessage(stanza as any);
    const room = store.getState().rooms.rooms[ROOM];
    expect(room.messages.some((m: any) => m.body === 'should be dropped')).toBe(false);
  });
});

describe('onMessageHistory — sender fallback for data without senderJID', () => {
  it('accepts a MAM history entry whose <data> has no senderJID/senderFirstName/senderLastName', async () => {
    const stanza = xml(
      'message',
      { from: ROOM },
      xml(
        'result',
        { id: 'archive-1', xmlns: 'urn:xmpp:mam:2' },
        xml(
          'forwarded',
          { xmlns: 'urn:xmpp:forward:0' },
          xml(
            'message',
            { from: OCCUPANT_FROM, type: 'groupchat', id: 'archive-1' },
            xml('data', {
              roomJID: ROOM,
              firstName: 'John',
              lastName: 'test_upd',
              userMessage: 'Spanish to translate',
            }),
            xml('body', {}, 'Spanish to translate')
          ),
          xml('delay', { stamp: '2026-01-01T00:00:00Z' })
        )
      )
    );

    await onMessageHistory(stanza as any);

    const room = store.getState().rooms.rooms[ROOM];
    expect(room.messages.some((m: any) => m.body === 'Spanish to translate')).toBe(true);
  });
});
