import { Client, xml } from '@xmpp/client';

// XEP-0184 delivery receipt, broadcast to the room (mirrors
// sendMessageReaction.xmpp.ts) so every occupant can render tick state.
// The top-level stanza `from` gets rewritten to the room/nick by the MUC
// server, so the real xmppUsername travels in the <received> `from` attr.
export function sendReceivedReceipt(
  client: Client,
  messageId: string,
  roomJid: string
) {
  const id = `message-received:${Date.now().toString()}`;

  const message = xml(
    'message',
    {
      id,
      type: 'groupchat',
      from: client.jid?.toString(),
      to: roomJid,
    },
    xml('received', {
      xmlns: 'urn:xmpp:receipts',
      id: messageId,
      from: client.jid?.toString(),
    }),
    // Live only: never archived (MAM). No client reads receipts or markers
    // back from history, and archived ones filled whole history pages, so
    // a room could open with no messages (see useRoomInitialization).
    xml('no-permanent-store', { xmlns: 'urn:xmpp:hints' })
  );

  client.send(message);
}
