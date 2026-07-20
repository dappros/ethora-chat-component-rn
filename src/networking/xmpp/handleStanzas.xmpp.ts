import { Element } from 'ltx';
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

export function handleStanza(stanza: Element, xmppWs: XmppClient) {
  if (stanza?.attrs?.type === 'headline') {return;}

  // Call signaling is swallowed before any chat handler sees it. A
  // `<data type="call-*">` frame is not user-visible content, and letting
  // it through renders bubbles reading "Deleted User: call-state" and
  // fires new-message notifications for a call that never happened.
  // Returns false for server call-LOGS, which do belong in the chat.
  if (stanza?.name === 'message' && onCallTokenMessage(stanza)) {
    return;
  }

  switch (stanza.name) {
    case 'message':
      onMessageError(stanza, xmppWs);
      onReactionMessage(stanza);
      onReactionHistory(stanza);
      onDeleteMessage(stanza);
      onEditMessage(stanza);
      onChatInvite(stanza, xmppWs);
      onRealtimeMessage(stanza);
      onMessageHistory(stanza);
      handleComposing(stanza, xmppWs.username);
      onPresenceInRoom(stanza);
      break;
    case 'presence':
      onRoomKicked(stanza);
      onPresenceInRoom(stanza);
      break;
    case 'iq':
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
