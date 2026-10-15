/**
 * End to end through the real dispatcher and the real store: a web
 * multi-attachment message with a caption arrives, then the other side's
 * delivery receipt and read marker for our own message. Pins what lands in
 * the store (message fields), what the tick reads, and that receipts and
 * markers never become messages or move the unread counter.
 */
import { parse } from 'ltx';
import { store } from '../src/roomStore';
import {
  addRoom,
  setLogoutState,
  setLastViewedTimestamp,
  setRoomMessages,
} from '../src/roomStore/roomsSlice';
import { logout, setUser } from '../src/roomStore/chatSettingsSlice';
import { handleStanza } from '../src/networking/xmpp/handleStanzas.xmpp';
import { getMessageAttachments } from '../src/helpers/attachments';
import { getReceiptStatus } from '../src/helpers/readReceipts';
import type { IMessage, IRoom } from '../src/types/types';

const ROOM = 'album@conference.xmpp.chat.ethora.com';
const ME = 'me_user';
const THEM = 'them_user';
const OWN_ID = '1700000000001';
const MEDIA_ID = '1700000000100';

const flush = async () => {
  for (let i = 0; i < 10; i++) {await Promise.resolve();}
  await new Promise((r) => setTimeout(r, 0));
};

const makeXmpp = () =>
  ({
    username: ME,
    sendReceivedReceiptStanza: jest.fn(),
    sendDisplayedMarkerStanza: jest.fn(),
  } as any);

const files = [0, 1, 2].map((n) => ({
  attachmentId: `att-${n}`,
  location: `https://files.example.com/${n}.png`,
  locationPreview: `https://files.example.com/p${n}.png`,
  mimetype: 'image/png',
  originalName: `photo-${n}.png`,
  fileName: `stored-${n}.png`,
  size: '1024',
}));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Shaped like the web sender's stanza: flat fields of attachment #0, the list
// in `attachments`, the caption and its spans as attributes.
const webAlbum = () =>
  parse(
    `<message type="groupchat" from="${ROOM}/${THEM}" id="${MEDIA_ID}">
       <body>media</body>
       <store xmlns="urn:xmpp:hints"/>
       <stanza-id xmlns="urn:xmpp:sid:0" by="${ROOM}" id="${MEDIA_ID}"/>
       <data senderJID="${THEM}@xmpp.chat.ethora.com" senderFirstName="Tess" senderLastName="Them"
         isMediafile="true" tokenAmount="0" receiverMessageId="0" mucname="album"
         location="${files[0].location}" locationPreview="${files[0].locationPreview}"
         mimetype="image/png" originalName="photo-0.png" fileName="stored-0.png" size="1024"
         attachmentId="att-0" roomJid="${ROOM}" push="true"
         attachments="${esc(JSON.stringify(files))}"
         caption="hello @Me" captionMentions="${esc(
           JSON.stringify([{ jid: `${ME}@xmpp.chat.ethora.com`, name: 'Me', offset: 6, length: 3 }])
         )}"/>
     </message>`
  );

const received = () =>
  parse(
    `<message type="groupchat" from="${ROOM}/${THEM}" id="message-received:1700000000200">
       <received xmlns="urn:xmpp:receipts" id="${OWN_ID}" from="${THEM}@xmpp.chat.ethora.com/web-1"/>
       <store xmlns="urn:xmpp:hints"/>
     </message>`
  );

const displayed = (targetId: string) =>
  parse(
    `<message type="groupchat" from="${ROOM}/${THEM}" id="message-displayed:1700000000300">
       <displayed xmlns="urn:xmpp:chat-markers:0" id="${targetId}" from="${THEM}@xmpp.chat.ethora.com/web-1"/>
       <store xmlns="urn:xmpp:hints"/>
     </message>`
  );

const room = () => store.getState().rooms.rooms[ROOM] as IRoom;

beforeEach(() => {
  store.dispatch(setLogoutState());
  store.dispatch(logout());
  store.dispatch(setUser({ xmppUsername: ME, walletAddress: '0xme' } as any));
  store.dispatch(
    addRoom({
      roomData: {
        id: ROOM,
        jid: ROOM,
        name: 'album',
        title: 'album',
        usersCnt: 2,
        messages: [],
        isLoading: false,
        roomBg: '',
        type: 'public',
      } as any,
    })
  );
  store.dispatch(
    setRoomMessages({
      roomJID: ROOM,
      messages: [
        {
          id: OWN_ID,
          body: 'mine',
          date: new Date(Number(OWN_ID)).toISOString(),
          roomJid: ROOM,
          user: { id: ME, name: ME },
        } as unknown as IMessage,
      ],
    })
  );
  // Everything up to our own message has been read: the next one is unread.
  store.dispatch(
    setLastViewedTimestamp({ chatJID: ROOM, timestamp: Number(OWN_ID) })
  );
});

describe('web album + caption, receipt and marker through handleStanza', () => {
  it('stores the album and caption, acks it once, and bumps unread by exactly one', async () => {
    const xmpp = makeXmpp();
    const unreadBefore = room().unreadMessages ?? 0;
    handleStanza(webAlbum(), xmpp);
    await flush();

    const stored = room().messages.find((m) => m.id === MEDIA_ID) as any;
    expect(stored).toBeTruthy();
    expect(String(stored.isMediafile)).toBe('true');
    expect(stored.caption).toBe('hello @Me');
    expect(stored.captionMentions).toEqual([
      expect.objectContaining({ name: 'Me', offset: 6, length: 3 }),
    ]);
    const attachments = getMessageAttachments(stored);
    expect(attachments.map((a) => a.originalName)).toEqual([
      'photo-0.png',
      'photo-1.png',
      'photo-2.png',
    ]);
    expect(attachments.map((a) => a.location)).toEqual(files.map((f) => f.location));
    // Flat legacy fields still describe attachment #0.
    expect(stored.location).toBe(files[0].location);

    expect(xmpp.sendReceivedReceiptStanza).toHaveBeenCalledTimes(1);
    expect(xmpp.sendReceivedReceiptStanza).toHaveBeenCalledWith(MEDIA_ID, ROOM);
    expect((room().unreadMessages ?? 0) - unreadBefore).toBe(1);
  });

  it('a delivery receipt then a read marker move the tick of our message, and are not messages', async () => {
    const xmpp = makeXmpp();
    handleStanza(webAlbum(), xmpp);
    await flush();
    const messageCount = room().messages.length;
    const unread = room().unreadMessages ?? 0;
    const selfId = ME;

    expect(getReceiptStatus({ id: OWN_ID, receivedBy: undefined }, room(), selfId).status).toBe('sent');

    handleStanza(received(), xmpp);
    await flush();
    const own = room().messages.find((m) => m.id === OWN_ID) as IMessage;
    expect(own.receivedBy?.[THEM]).toEqual(expect.any(Number));
    expect(getReceiptStatus(own, room(), selfId).status).toBe('delivered');

    // The marker names the album, which sits after our message: it covers it.
    handleStanza(displayed(MEDIA_ID), xmpp);
    await flush();
    expect(room().lastDisplayedByUser?.[THEM]).toBe(MEDIA_ID);
    const own2 = room().messages.find((m) => m.id === OWN_ID) as IMessage;
    const status = getReceiptStatus(own2, room(), selfId);
    expect(status.status).toBe('seen');
    expect(status.seenBy).toEqual([THEM]);

    // Neither frame became a message, was acked back, or touched unread.
    expect(room().messages.length).toBe(messageCount);
    expect(room().unreadMessages ?? 0).toBe(unread);
    expect(xmpp.sendReceivedReceiptStanza).toHaveBeenCalledTimes(1);
  });

  it('our own echo of a media message is never acked', async () => {
    const xmpp = makeXmpp();
    const own = webAlbum();
    own.attrs.from = `${ROOM}/${ME}`;
    own.attrs.id = '1700000000400';
    (own.getChild('stanza-id') as any).attrs.id = '1700000000400';
    (own.getChild('data') as any).attrs.senderJID = `${ME}@xmpp.chat.ethora.com`;
    handleStanza(own, xmpp);
    await flush();
    expect(xmpp.sendReceivedReceiptStanza).not.toHaveBeenCalled();
  });
});
