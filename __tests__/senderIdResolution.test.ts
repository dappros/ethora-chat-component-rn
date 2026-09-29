/**
 * Sender identity comes off the stanza, never off the `<data>` name
 * attributes: the occupant RESOURCE of `from` first, then the localpart of
 * `<data senderJID>` — exactly what the web SDK's getDataFromXml does.
 * `usersSet` then resolves that id to a first + last name.
 *
 * RN only had the resource. The translate-tagged send path arrives with no
 * occupant resource, so `user.id` came out undefined and the downstream
 * fallback landed on the bare room jid's localpart — for a 1:1 room that is
 * `<appId>_<userA>-<appId>_<userB>`, and THAT composite id is what got
 * rendered as the sender's name.
 */

import { Element } from 'ltx';
import { getDataFromXml } from '../src/helpers/getDataFromXml';
import { store } from '../src/roomStore';
import { setUser } from '../src/roomStore/chatSettingsSlice';

const APP = '646cc8dc96d4a4dc8f7b2f2d';
const ME = `${APP}_6a2718bcef26ca2d3e1b78c3`;
const THEM = `${APP}_6a46007ce7b43f307b6da578`;
const ROOM = `${ME}-${THEM}`;
const CONF = 'conference.xmpp.chat-qa.ethora.com';

const stanza = (attrs: Record<string, string>, dataAttrs: Record<string, string>) => {
  const msg = new Element('message', attrs);
  msg.c('body').t('hi, this message is in english');
  msg.c('data', dataAttrs);
  return msg;
};

beforeAll(() => {
  // normalizeXmppUsername derives the appId from the logged-in user's own
  // xmppUsername, so the store has to know who we are.
  store.dispatch(setUser({ xmppUsername: ME } as any));
});

describe('sender id resolution', () => {
  it('uses the occupant resource when the stanza has one', async () => {
    const parsed = await getDataFromXml(
      stanza({ from: `${ROOM}@${CONF}/${THEM}`, id: 'a1' }, { senderJID: `${THEM}@h` })
    );
    expect(parsed?.user?.id).toBe(THEM);
  });

  it('falls back to the senderJID localpart when there is no resource', async () => {
    const parsed = await getDataFromXml(
      stanza({ from: `${ROOM}@${CONF}`, id: 'a2' }, { senderJID: `${THEM}@h` })
    );
    // The regression: this used to be undefined, and the name chain then
    // resolved to the room's composite id.
    expect(parsed?.user?.id).toBe(THEM);
    expect(parsed?.user?.id).not.toBe(ROOM);
  });

  it('never resolves the sender to the room id', async () => {
    const parsed = await getDataFromXml(
      stanza({ from: `${ROOM}@${CONF}`, id: 'a3' }, { senderJID: `${THEM}@h` })
    );
    expect(parsed?.roomJid).toBe(`${ROOM}@${CONF}`);
    expect(parsed?.user?.id).not.toBe(parsed?.roomJid?.split('@')[0]);
  });

  it('collapses a doubled appId prefix so the usersSet key matches', async () => {
    const parsed = await getDataFromXml(
      stanza(
        { from: `${ROOM}@${CONF}/${APP}_${THEM}`, id: 'a4' },
        { senderJID: `${THEM}@h` }
      )
    );
    expect(parsed?.user?.id).toBe(THEM);
  });
});
