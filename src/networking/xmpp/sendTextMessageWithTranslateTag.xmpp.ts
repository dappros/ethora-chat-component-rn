import { Client, xml } from '@xmpp/client';
import { Iso639_1Codes } from '../../types/types';
import { toServiceXmlns } from './sendTextMessage.xmpp';
import { sendEncrypted, shouldEncrypt } from '../../e2ee/send';

/**
 * Same wire message as `sendTextMessage`, plus a `<translate source="xx"/>`
 * child that DECLARES the message's source language so the backend can
 * translate it for readers in other languages. No pre-translation happens
 * client-side.
 *
 * The `<data>` element MUST be built identically to `sendTextMessage`
 * (correct `xmlns` = the `wss://<host>/ws` service URL, and the
 * `senderFirstName` / `senderLastName` / `senderJID` / `roomJid` attr
 * names the server + parser expect). An earlier version spread a loose
 * `stanzaMessage` bag into `<data>` with no xmlns and mismatched attr
 * names — the server silently dropped those stanzas, so no echo came back
 * and every sent message stayed stuck in the "pending" state. Keep this in
 * lockstep with sendTextMessage.xmpp.ts.
 */
export const sendTextMessageWithTranslateTag = (
  client: Client,
  stanzaMessage: {
    roomJID: string;
    firstName: string;
    lastName: string;
    photo: string;
    walletAddress: string;
    userMessage: string;
    notDisplayedValue?: string;
    isReply?: boolean;
    showInChannel?: boolean;
    mainMessage?: string;
    devServer?: string;
  },
  source: Iso639_1Codes,
  customId?: string
): boolean => {
  const id = customId || `send-text-message-${Date.now()}`;

  try {
    const dataXmlns = toServiceXmlns(stanzaMessage.devServer, client);
    const data = xml('data', {
        xmlns: dataXmlns,
        senderFirstName: stanzaMessage.firstName,
        senderLastName: stanzaMessage.lastName,
        fullName: `${stanzaMessage.firstName} ${stanzaMessage.lastName}`,
        photoURL: stanzaMessage.photo,
        senderJID: client.jid?.toString(),
        senderWalletAddress: stanzaMessage.walletAddress,
        roomJid: stanzaMessage.roomJID,
        isSystemMessage: false,
        tokenAmount: 0,
        quickReplies: '',
        notDisplayedValue: '',
        showInChannel: stanzaMessage.showInChannel || false,
        isReply: stanzaMessage.isReply || false,
        mainMessage: stanzaMessage.mainMessage || '',
        push: 'true',
      });
    const body = xml('body', {}, stanzaMessage.userMessage);
    const envelope = { to: stanzaMessage.roomJID, type: 'groupchat', id };

    if (shouldEncrypt(stanzaMessage.roomJID)) {
      sendEncrypted(
        client,
        stanzaMessage.roomJID,
        id,
        data,
        body,
        xml('message', envelope, data, body)
      );
      return true;
    }

    const message = xml(
      'message',
      envelope,
      data,
      body,
      // `<translate source>` only DECLARES the language this text is in; it
      // costs nothing to send and is what lets each reader translate the
      // message into their own language on their side.
      xml('translate', { source })
    );

    client.send(message);
    return true;
  } catch (error) {
    console.error('An error occurred while sending message:', error);
    return false;
  }
};
