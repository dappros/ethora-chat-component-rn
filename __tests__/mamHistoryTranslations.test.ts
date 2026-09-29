/**
 * The MAM history path must parse the FULL stanza — <translations> payload
 * and <translate source> included — exactly like the realtime path and the
 * web SDK's history handler.
 *
 * It used to call createMessageFromXml positionally with only <data> attrs
 * + <body>, so every archived message lost `translations` AND `langSource`.
 * Since a transcript is MAM-backfilled on every room open, that single
 * parse made translation look completely dead: the translations existed on
 * the wire and were dropped right here. (The persist layer deliberately
 * drops translations too, web-parity, so MAM is the ONLY thing that can
 * re-hydrate them.)
 */

import { Element } from 'ltx';
import { store } from '../src/roomStore';
import { setUser } from '../src/roomStore/chatSettingsSlice';
import { addRoom } from '../src/roomStore/roomsSlice';
import { IRoom } from '../src/types/types';

const APP = '646cc8dc96d4a4dc8f7b2f2d';
const ME = `${APP}_6a2718bcef26ca2d3e1b78c3`;
const THEM = `${APP}_6a46007ce7b43f307b6da578`;
const ROOM = `${ME}-${THEM}@conference.xmpp.chat-qa.ethora.com`;

const mamStanza = () => {
  // <message><result id><forwarded><message from=room/nick>
  //   <data senderJID=.../><body>...</body>
  //   <translations value='{"translates":[...]}'/><translate source="en"/>
  const outer = new Element('message', { to: `${ME}@h`, from: ROOM });
  const result = outer.c('result', {
    xmlns: 'urn:xmpp:mam:2',
    id: '1786000000000001',
  });
  const fwd = result.c('forwarded', { xmlns: 'urn:xmpp:forward:0' });
  // Real MAM results carry a <delay> stamp; the handler keys off it.
  fwd.c('delay', {
    xmlns: 'urn:xmpp:delay',
    stamp: '2026-08-07T08:39:00.000Z',
  });
  const inner = fwd.c('message', {
    from: `${ROOM}/${THEM}`,
    id: 'orig-1',
    type: 'groupchat',
  });
  inner.c('data', {
    senderJID: `${THEM}@h`,
    senderFirstName: 'John',
    senderLastName: 'Doe',
  });
  inner.c('body').t('hi, this message is in english');
  inner.c('translations', {
    value: JSON.stringify({
      translates: [
        {
          translatedText: 'hola, este mensaje está en inglés',
          language: 'es',
          languageName: 'Spanish',
        },
      ],
    }),
  });
  inner.c('translate', { source: 'en' });
  return outer;
};

describe('MAM history keeps translations', () => {
  it('an archived message lands in the store with translations + langSource', async () => {
    store.dispatch(setUser({ xmppUsername: ME } as any));
    // addRoomMessage drops messages for unknown rooms (the "stanza before
    // /chats/my" race guard) — seed the room the way REST would have.
    store.dispatch(
      addRoom({ roomData: { jid: ROOM, name: 'r', title: 'r' } as IRoom })
    );

    const { onMessageHistory } = require('../src/networking/stanzaHandlers');
    await onMessageHistory(mamStanza());

    const room = store.getState().rooms.rooms[ROOM];
    expect(room).toBeDefined();
    const msg = (room.messages || []).find(
      (m: any) => m.body === 'hi, this message is in english'
    ) as any;
    expect(msg).toBeDefined();

    // The regression: both of these came out undefined, which killed
    // useMessageTranslation's guards (no source language, nothing attached)
    // for the entire backfilled transcript.
    expect(msg.langSource).toBe('en');
    expect(msg.translations?.es?.translatedText).toBe(
      'hola, este mensaje está en inglés'
    );
  });
});
