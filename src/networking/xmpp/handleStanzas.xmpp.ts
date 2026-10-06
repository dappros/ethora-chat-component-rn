import { Element } from 'ltx';
import { routeMamIq } from './mamRouter';
import {
  onDeleteMessage,
  onEditMessage,
  onRealtimeMessage,
  onMessageHistory,
  onGetLastMessageArchive,
  handleComposing,
  onChatInvite,
  onPresenceInRoom,
  onGetChatRooms,
  onGetMembers,
  onGetRoomInfo,
  onNewRoomCreated,
  onReactionMessage,
  onReactionHistory,
  onRoomKicked,
  onMessageError,
} from '../stanzaHandlers';
import XmppClient from '../xmppClient';
import { onCallTokenMessage } from '../callTokenStanza';
import { accountDomain, isE2eeEnabled } from '../../e2ee';
import {
  decryptStanzaInPlace,
  encryptedCarrier,
  rewriteEncryptedStanza,
} from '../../e2ee/stanza';

/**
 * Unwrap a mucsub event wrapper so the chat handlers see the real inner
 * `<message>` (the one carrying `<data senderJID=…>` and `<body>`).
 *
 * We subscribe every room to `urn:xmpp:mucsub:nodes:messages` (see
 * subscribeToRoomMessages / pushSubscriptionService), so ejabberd pushes
 * room traffic as:
 *
 *   <message from="room@conference/…">
 *     <event xmlns="http://jabber.org/protocol/pubsub#event">
 *       <items node="urn:xmpp:mucsub:nodes:messages">
 *         <item><message …><data senderJID=…/><body>…</body></message></item>
 *
 * Without unwrapping, onRealtimeMessage reads `<data>` off the OUTER
 * wrapper, finds nothing, logs "Missing data elements in real-time
 * message" and drops the stanza — so live messages never render and only
 * surface later through the MAM history fetch (i.e. after an app restart
 * or re-opening the room). Mirrors the web SDK's handleStanza.
 */
const unwrapMucsubMessage = (stanza: Element): Element => {
  const inner = (stanza as any)
    ?.getChild?.('event', 'http://jabber.org/protocol/pubsub#event')
    ?.getChild?.('items')
    ?.getChild?.('item')
    ?.getChild?.('message');
  return (inner as Element) || stanza;
};

let held = 0;
let queue: Promise<void> = Promise.resolve();

export function handleStanza(stanza: Element, xmppWs: XmppClient) {
  if (!isE2eeEnabled()) {
    dispatchStanza(stanza, xmppWs);
    return;
  }
  const carrier =
    stanza?.name === 'message' ? encryptedCarrier(stanza) : undefined;
  if (!carrier && held === 0) {
    dispatchStanza(stanza, xmppWs);
    return;
  }

  held++;
  queue = queue.then(async () => {
    try {
      if (carrier) {
        const outcome = await decryptStanzaInPlace(
          stanza,
          accountDomain(xmppWs.client)
        );
        if (outcome === 'drop') {return;}
      }
      dispatchStanza(stanza, xmppWs);
    } catch (err) {
      console.warn('OMEMO: failed to handle stanza', err);
    } finally {
      held--;
    }
  });
}

export const __resetStanzaQueueForTests = (): void => {
  held = 0;
  queue = Promise.resolve();
};

function dispatchStanza(stanza: Element, xmppWs: XmppClient) {
  if (stanza?.attrs?.type === 'headline') {return;}

  // Call signaling is swallowed before any chat handler sees it. A
  // `<data type="call-*">` frame is not user-visible content, and letting
  // it through renders bubbles reading "Deleted User: call-state" and
  // fires new-message notifications for a call that never happened.
  // Returns false for server call-LOGS, which do belong in the chat.
  if (stanza?.name === 'message' && onCallTokenMessage(stanza)) {
    return;
  }

  if (stanza?.name === 'message' && rewriteEncryptedStanza(stanza) === 'drop') {
    return;
  }

  switch (stanza.name) {
    case 'message': {
      const unwrapped = unwrapMucsubMessage(stanza);
      onMessageError(unwrapped, xmppWs);
      onReactionMessage(unwrapped);
      onReactionHistory(unwrapped);
      onDeleteMessage(unwrapped);
      onEditMessage(unwrapped);
      onChatInvite(unwrapped, xmppWs);
      onRealtimeMessage(unwrapped);
      onMessageHistory(unwrapped);
      handleComposing(unwrapped, xmppWs.username);
      onPresenceInRoom(unwrapped);
      break;
    }
    case 'presence':
      onRoomKicked(stanza);
      onPresenceInRoom(stanza);
      break;
    case 'iq':
      if (routeMamIq(stanza)) {break;}
      onGetChatRooms(stanza, xmppWs);
      onRealtimeMessage(stanza);
      onPresenceInRoom(stanza);
      onGetMembers(stanza);
      onGetRoomInfo(stanza);
      onGetLastMessageArchive(stanza, xmppWs);
      break;
    case 'room-config':
      onNewRoomCreated(stanza, xmppWs);
      break;
    default:
      console.log('Unhandled stanza type:', stanza.name);
  }
}
