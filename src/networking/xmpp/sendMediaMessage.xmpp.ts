import { Client, xml } from '@xmpp/client';

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

export function sendMediaMessage(
  client: Client,
  roomJID: string,
  data: any,
  customId?: string,
  devServer?: string
) {
  const id =
    customId || `send-media-message-${Date.now().toString()}`;

  const dataToSend = {
    xmlns: toServiceXmlns(devServer, client),
    senderJID: client.jid?.toString(),
    senderFirstName: data.firstName,
    senderLastName: data.lastName,
    senderWalletAddress: data.walletAddress,
    isSystemMessage: false,
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

  const message = xml(
    'message',
    {
      id: id,
      type: 'groupchat',
      from: client.jid?.toString(),
      to: roomJID,
    },
    xml('body', {}, 'media'),
    xml('store', { xmlns: 'urn:xmpp:hints' }),
    xml('data', dataToSend)
  );

  console.log('🟢 [sendMediaMessage] sending stanza', {
    id,
    to: roomJID,
    mime: data?.mimetype,
    name: data?.fileName,
  });
  try {
    const sendResult = client.send(message);
    if (sendResult && typeof (sendResult as any).then === 'function') {
      (sendResult as Promise<unknown>)
        .then(() => console.log('🟢 [sendMediaMessage] client.send resolved', { id }))
        .catch((err) =>
          console.error('🔴 [sendMediaMessage] client.send REJECTED', {
            id,
            message: (err as any)?.message,
          })
        );
    }
  } catch (error) {
    console.error('🔴 [sendMediaMessage] sync error', error);
  }
  return id;
}
