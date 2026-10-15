import { Client, xml } from '@xmpp/client';

// XEP-0333 read marker, broadcast to the room (same convention as
// sendReceivedReceipt.xmpp.ts / sendMessageReaction.xmpp.ts). `messageId` is
// the id of the newest message the user has displayed - a single watermark
// per room, not one marker per message.
export function sendDisplayedMarker(
  client: Client,
  messageId: string,
  roomJid: string
) {
  const id = `message-displayed:${Date.now().toString()}`;

  const message = xml(
    'message',
    {
      id,
      type: 'groupchat',
      from: client.jid?.toString(),
      to: roomJid,
    },
    xml('displayed', {
      xmlns: 'urn:xmpp:chat-markers:0',
      id: messageId,
      from: client.jid?.toString(),
    }),
    xml('store', { xmlns: 'urn:xmpp:hints' })
  );

  client.send(message);
}
