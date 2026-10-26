import { store } from '../roomStore';
import {
  acceptIncomingCall,
  setCallError,
  startOutgoingCall,
} from '../roomStore/callSlice';
import { sendCallInviteSignal } from '../networking/callTokenStanza';
import { requestOutgoingCall } from '../calls/startCall';
import { chatNameOfRoom } from './scheduledCall';

/**
 * Joining a scheduled call is the ordinary call start for that room, taken
 * on a user tap: a private room starts (or answers) its call, a group or
 * public room starts or joins the room call. This file is the ONE place the
 * booking flow reaches into the call path, so when the call transport
 * changes only this function follows (it mirrors CallButtons.placeCall and
 * hands the request to the shared requestOutgoingCall, so a private room
 * gets the p2p call and a group room the LiveKit one, as the server decides).
 */

export type StartRoomCallOutcome =
  | 'started'
  | 'answered'
  | 'busy'
  | 'disabled'
  | 'no-room'
  | 'failed';

const BAD_TITLES = ['deleted', 'deleted user', 'unknown', 'null'];

export const startRoomCall = async (
  roomJid: string,
  kind: 'audio' | 'video'
): Promise<StartRoomCallOutcome> => {
  const state = store.getState();
  if (state.chatSettingStore.config?.videoCalls?.enabled !== true) {
    return 'disabled';
  }
  const chatName = chatNameOfRoom(roomJid);
  if (!chatName) {return 'no-room';}

  const room = Object.values(state.rooms.rooms || {}).find(
    (r: any) => chatNameOfRoom(r?.jid || '') === chatName
  ) as any;
  const fullJid: string = room?.jid || roomJid;
  if (!fullJid.includes('@')) {return 'no-room';}

  const call = state.call;
  if (call.phase !== 'idle') {
    // The same room is already ringing us: joining means answering it.
    if (
      call.phase === 'ringing-incoming' &&
      call.roomBareName === chatName
    ) {
      store.dispatch(acceptIncomingCall());
      return 'answered';
    }
    return 'busy';
  }

  const selfLocal = String(
    state.chatSettingStore.user?.xmppUsername || ''
  ).split('@')[0];
  const isGroup = room?.type === 'group';
  const peer =
    room?.type === 'private'
      ? (room?.members || []).find((member: any) => {
          const local = String(member?.xmppUsername || '').split('@')[0];
          return local && local !== selfLocal;
        })
      : undefined;
  const peerXmppUsername: string | null = peer?.xmppUsername || null;

  const rawTitle = String(room?.title || room?.name || '').trim();
  const peerDisplay = peer
    ? `${peer.firstName || ''} ${peer.lastName || ''}`.trim() || peer.name || ''
    : '';
  const bad = !rawTitle || BAD_TITLES.includes(rawTitle.toLowerCase());
  const dialName = (bad ? peerDisplay : rawTitle) || peerDisplay || chatName;

  store.dispatch(
    startOutgoingCall({
      roomJid: fullJid,
      roomName: dialName,
      roomBareName: chatName,
      kind,
      peerXmppUsername,
      isGroup,
    })
  );
  if (peerXmppUsername) {
    sendCallInviteSignal(kind, { peerXmppUsername, roomBareName: chatName });
  }
  try {
    await requestOutgoingCall({ chatName, kind, peerXmppUsername });
    return 'started';
  } catch (error) {
    store.dispatch(
      setCallError(error instanceof Error ? error.message : 'call failed')
    );
    return 'failed';
  }
};
