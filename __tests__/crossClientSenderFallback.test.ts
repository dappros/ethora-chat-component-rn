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
import { setUser } from '../src/roomStore/chatSettingsSlice';
import { onRealtimeMessage, onMessageHistory } from '../src/networking/stanzaHandlers';
import { isOwnMessage } from '../src/helpers/isOwnMessage';

const ROOM = 'room@conference.h';
const OCCUPANT_FROM = `${ROOM}/John`;
const SELF_WALLET = 'self-wallet-999';
const OTHER_WALLET = 'other-wallet-111';

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
    const msg = room.messages.find((m: any) => m.body === 'Spanish to translate');
    // Bug #41: this used to fall back to splitting the *room's own* JID
    // local part (from the MUC occupant `from`) on '@', since createMessageFromXml
    // never got a resource-bearing `from` for the MAM/positional path. It
    // must resolve the actual sender ("John", the occupant resource) -
    // same as the onRealtimeMessage sibling test above - not the room id.
    expect(msg.user.id).toContain('John');
    expect(msg.user.id).not.toBe(ROOM.split('@')[0]);
  });
});

describe('onMessageHistory - bug #41 (reconnect catch-up must not render as own)', () => {
  it('a MAM catch-up message from another user gets a non-empty sender id that never equals the current user', async () => {
    store.dispatch(
      setUser({ walletAddress: SELF_WALLET, xmppUsername: '' } as any)
    );

    const otherOccupantFrom = `${ROOM}/${OTHER_WALLET}`;
    const stanza = xml(
      'message',
      { from: ROOM },
      xml(
        'result',
        { id: 'archive-catchup-1', xmlns: 'urn:xmpp:mam:2' },
        xml(
          'forwarded',
          { xmlns: 'urn:xmpp:forward:0' },
          xml(
            'message',
            {
              from: otherOccupantFrom,
              type: 'groupchat',
              id: 'send-message:catchup-1',
            },
            xml('data', {
              senderFirstName: 'Other',
              senderLastName: 'User',
              senderJID: `${OTHER_WALLET}@h/theirSessionResource`,
              senderWalletAddress: OTHER_WALLET,
              roomJid: ROOM,
              isSystemMessage: 'false',
            }),
            xml('body', {}, 'hello while you were offline')
          ),
          xml('delay', { stamp: '2026-01-01T00:00:00Z' })
        )
      )
    );

    await onMessageHistory(stanza as any);

    const room = store.getState().rooms.rooms[ROOM];
    const msg = room.messages.find(
      (m: any) => m.body === 'hello while you were offline'
    );
    expect(msg).toBeTruthy();
    // Non-empty and correctly attributed to the actual sender...
    expect(msg.user.id).toBeTruthy();
    expect(msg.user.id).toContain(OTHER_WALLET);
    // ...and never equal to the current user, from the very first
    // render - no flip from "own" (right) to "other" (left) needed.
    expect(msg.user.id).not.toBe(SELF_WALLET);
    expect(
      isOwnMessage(msg, store.getState().chatSettingStore.user)
    ).toBe(false);
  });

  it('isOwnMessage never treats two blank ids as a match (the actual bug #41 symptom)', () => {
    const blankMessage = { user: { id: '' } } as any;
    const blankCurrentUser = { xmppUsername: '', walletAddress: '' };
    expect(isOwnMessage(blankMessage, blankCurrentUser)).toBe(false);
    expect(isOwnMessage(undefined, undefined)).toBe(false);
  });
});
