import { Client, xml } from '@xmpp/client';
import { sendSealedMedia, shouldEncrypt } from '../../e2ee/send';
import type { IAttachment, IMentionSpan } from '../../types/types';
import { serializeAttachments } from '../../helpers/attachments';
import { normalizeCaptionInput } from '../../helpers/caption';

// Monotonic counter — see sendTextMessage for the rationale (avoids
// Date.now() id collisions on <1ms-apart sends).
let _sendMediaSeq = 0;

/**
 * Same xmlns derivation as sendTextMessage — the server registers app
 * messages under the WSS service URL (`wss://<host>/ws`), and stanzas
 * carrying a bare hostname (or no xmlns at all) get silently dropped.
 */
const toServiceXmlns = (devServer: string | undefined, client: Client): string => {
  const clientService = (client as any)?.options?.service as string | undefined;
  if (clientService && /^wss?:\/\//.test(clientService)) {return clientService;}
  const ds = (devServer || '').trim();
  if (!ds) {return 'wss://xmpp.ethoradev.com/ws';}
  if (/^wss?:\/\//.test(ds)) {return ds;}
  if (ds.includes('://')) {return ds;}
  return `wss://${ds.replace(/^\/+|\/+$/g, '')}/ws`;
};

/**
 * One media stanza for one or more files.
 *
 * `data` carries the flat fields that describe attachment #0, so a client
 * that predates multi-attach still shows the first file. With more than one
 * file the whole list rides on `<data attachments='JSON'>` (selection order).
 *
 * A typed caption rides on the message too: as `caption` / `captionMentions`
 * attributes in a plain room, and inside the sealed <body> in an e2ee room
 * (never as an attribute there). A message with one file and no caption is
 * byte-identical to what this function produced before multi-attach.
 */
export function sendMediaMessage(
  client: Client,
  roomJID: string,
  data: any,
  customId?: string,
  devServer?: string
) {
  const id =
    customId || `send-media-message-${Date.now()}-${(_sendMediaSeq = (_sendMediaSeq + 1) >>> 0)}`;

  const dataToSend: Record<string, unknown> = {
    xmlns: toServiceXmlns(devServer, client),
    senderJID: client.jid?.toString(),
    senderFirstName: data.firstName,
    senderLastName: data.lastName,
    senderWalletAddress: data.walletAddress,
    tokenAmount: '0',
    receiverMessageId: '0',
    mucname: data.chatName,
    photoURL: data.userAvatar ? data.userAvatar : '',
    isMediafile: true,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    fileName: data.fileName,
    isVisible: data.isVisible,
    location: data.location,
    locationPreview: data.locationPreview,
    mimetype: data.mimetype,
    originalName: data.originalName,
    ownerKey: data.ownerKey,
    size: data.size,
    duration: data?.duration,
    updatedAt: data.updatedAt,
    userId: data.userId,
    waveForm: data.waveForm,
    attachmentId: data?.attachmentId,
    isReply: data?.isReply,
    showInChannel: data?.showInChannel,
    mainMessage: data?.mainMessage,
    roomJid: data?.roomJid,
    push: 'true',
  };

  // Only stamped when there is more than one file, so a single-file stanza
  // keeps exactly the attributes it always had.
  const files: IAttachment[] = Array.isArray(data?.attachments) ? data.attachments : [];
  if (files.length > 1) {
    // The flat fields describe attachment #0, whatever the caller passed, so
    // an older client shows the first file of the message.
    const head = files[0]!;
    const flat: Array<keyof IAttachment> = [
      'attachmentId',
      'location',
      'locationPreview',
      'mimetype',
      'originalName',
      'fileName',
      'size',
      'duration',
    ];
    for (const key of flat) {
      const value = head[key];
      if (value !== undefined && value !== null && value !== '') {
        dataToSend[key] = value;
      }
    }
    dataToSend.attachments = serializeAttachments(files);
  }

  const keys: string[] | undefined = data?.e2eeKeys;
  if (keys?.length) {
    dataToSend.clientEncrypted = 'true';
  }

  const caption = normalizeCaptionInput({
    text: typeof data?.caption === 'string' ? data.caption : '',
    mentions: data?.captionMentions as IMentionSpan[] | undefined,
  });
  const hints = xml('store', { xmlns: 'urn:xmpp:hints' });

  if (keys?.length && shouldEncrypt(roomJID)) {
    // The caption is sealed with the keys. It is never copied onto <data>.
    const sealedBody = caption
      ? { v: 1, keys, caption: caption.caption, ...(caption.mentions ? { captionMentions: caption.mentions } : {}) }
      : { v: 1, keys };
    sendSealedMedia(
      client,
      roomJID,
      id,
      xml('body', {}, JSON.stringify(sealedBody)),
      [xml('data', dataToSend), hints]
    );
    return id;
  }

  if (caption) {
    dataToSend.caption = caption.caption;
    if (caption.mentions) {
      dataToSend.captionMentions = JSON.stringify(caption.mentions);
    }
  }

  const message = xml(
    'message',
    {
      id: id,
      type: 'groupchat',
      from: client.jid?.toString(),
      to: roomJID,
    },
    xml('body', {}, 'media'),
    hints,
    xml('data', dataToSend)
  );

  try {
    const sendResult = client.send(message);
    if (sendResult && typeof (sendResult as any).then === 'function') {
      (sendResult as Promise<unknown>)
        .then(() => console.log('client.send resolved', { id }))
        .catch((err) =>
          console.error('client.send REJECTED', {
            id,
            message: (err as any)?.message,
          })
        );
    }
  } catch (error) {
    console.error(error);
  }
  return id;
}
