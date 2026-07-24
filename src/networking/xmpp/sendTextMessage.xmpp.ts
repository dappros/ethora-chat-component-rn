import { Client, xml } from '@xmpp/client';

// Local monotonic counter — see comment in id construction below.
let _sendTextSeq = 0;

/**
 * Normalize devServer to the WSS service URL that the server uses as
 * the data-element xmlns. The user-facing `xmppDevServer` config
 * typically holds a bare hostname (`xmpp.chat.ethora.com`); the server
 * registers messages under the full `wss://<host>/ws` URL, and stanzas
 * carrying just the bare host as xmlns get silently dropped.
 *
 * Mirrors web's `SERVICE` derivation (utils/runtimeHostConfig.ts).
 */
export const toServiceXmlns = (devServer: string | undefined, client: Client): string => {
  // Prefer the URL the client is actually connected to — guaranteed to
  // be the one the server expects.
  const clientService = (client as any)?.options?.service as string | undefined;
  if (clientService && /^wss?:\/\//.test(clientService)) {return clientService;}
  const ds = (devServer || '').trim();
  if (!ds) {return 'wss://xmpp.ethoradev.com/ws';}
  if (/^wss?:\/\//.test(ds)) {return ds;}
  if (ds.includes('://')) {return ds;}
  // Bare host → wss://<host>/ws
  return `wss://${ds.replace(/^\/+|\/+$/g, '')}/ws`;
};

export const sendTextMessage = (
  client: Client,
  roomJID: string,
  firstName: string,
  lastName: string,
  photo: string,
  walletAddress: string,
  userMessage: string,
  notDisplayedValue?: string,
  isReply?: boolean,
  showInChannel?: boolean,
  mainMessage?: string,
  devServer?: string,
  customId?: string
) => {
  // Same monotonic-counter pattern as useSendMessage.nextStanzaId, to
  // protect direct callers that don't supply a customId from
  // Date.now() collisions when sends happen <1ms apart.
  if (!_sendTextSeq) {/* noop guarded init */}
  const id = customId
    ? customId
    : isReply
      ? `send-reply-message-${Date.now()}-${(_sendTextSeq = (_sendTextSeq + 1) >>> 0)}`
      : `send-text-message-${Date.now()}-${(_sendTextSeq = (_sendTextSeq + 1) >>> 0)}`;

  try {
    const dataXmlns = toServiceXmlns(devServer, client);
    const message = xml(
      'message',
      {
        to: roomJID,
        type: 'groupchat',
        id: id,
      },
      xml('data', {
        xmlns: dataXmlns,
        senderFirstName: firstName,
        senderLastName: lastName,
        fullName: `${firstName} ${lastName}`,
        photoURL: photo,
        senderJID: client.jid?.toString(),
        senderWalletAddress: walletAddress,
        roomJid: roomJID,
        isSystemMessage: false,
        tokenAmount: 0,
        quickReplies: '',
        notDisplayedValue: '',
        showInChannel: showInChannel || false,
        isReply: isReply || false,
        mainMessage: mainMessage || '',
        push: 'true',
      }),
      xml('body', {}, userMessage)
    );
    const sendResult = client.send(message);
    if (sendResult && typeof (sendResult as any).then === 'function') {
      (sendResult as Promise<unknown>)
        .then(() => console.log('client.send resolved', { id }))
        .catch((err) =>
          console.error('client.send REJECTED', {
            id,
            message: (err as any)?.message,
            name: (err as any)?.name,
            stack: (err as any)?.stack,
          })
        );
    } else {
      console.log('🟡 [sendTextMessage] client.send returned non-promise', { id, type: typeof sendResult });
    }
  } catch (error) {
    console.error(error);
  }
};
