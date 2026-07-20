import { store } from '../roomStore';
import { setIncomingCallToken } from '../roomStore/callSlice';
import { isCallPush, parseCallPush } from './callPush';

/**
 * Turn an incoming-call push into a ringing call.
 *
 * On mobile the XMPP socket dies whenever the OS backgrounds or kills the
 * app, and the `call-token` stanza that normally opens the ring screen is
 * lost with it. The backend also delivers the call as a data push, so this
 * is the path every call takes when the app was not in the foreground.
 *
 * Returns true when the payload WAS a call push (whether or not it could
 * be rung), so the caller knows to stop and not also show it as a chat
 * notification. A user should never get a "new message: call-state" toast.
 */
export const handleCallPush = (
  data: Record<string, any> | null | undefined
): boolean => {
  if (!isCallPush(data)) {
    return false;
  }

  const parsed = parseCallPush(data);
  const state = store.getState();

  // Calls off in this deployment: swallow the push rather than ringing a
  // screen the host never opted into.
  if (state.chatSettingStore.config?.videoCalls?.enabled !== true) {
    return true;
  }

  // Already ringing or in this exact call (the push raced the stanza, or
  // two pushes arrived). Re-dispatching would reset startedAt and restart
  // the ring, so leave the existing call alone.
  const current = state.call;
  if (current.phase !== 'idle') {
    const sameCall =
      (!!parsed.callId && parsed.callId === current.callId) ||
      (!!parsed.roomBareName && parsed.roomBareName === current.roomBareName);
    if (sameCall || current.phase === 'in-call') {
      return true;
    }
  }

  // Without a LiveKit token there is nothing to accept: the push is only
  // an alert. Ringing anyway would give the user an Accept button that
  // cannot work, so treat it as handled and let the stanza (once the
  // socket is back up) open the real ring screen.
  if (!parsed.token) {
    return true;
  }

  // Resolve the full room JID from the local room map. The push carries
  // the bare name; callSlice and the hangup signal both want the JID.
  const rooms = state.rooms.rooms || {};
  const resolved = Object.values(rooms).find(
    (room: any) =>
      (room?.jid || '').split('@')[0] === parsed.roomBareName ||
      room?.jid === parsed.roomRef
  ) as { jid?: string; name?: string } | undefined;

  const roomJid =
    resolved?.jid ||
    (parsed.roomRef && parsed.roomRef.includes('@') ? parsed.roomRef : '');
  if (!roomJid) {
    return true;
  }

  store.dispatch(
    setIncomingCallToken({
      roomJid,
      roomName: parsed.callerName || resolved?.name || null,
      roomBareName: parsed.roomBareName,
      token: parsed.token,
      kind: parsed.kind,
      callId: parsed.callId,
      peerXmppUsername: parsed.callerXmppUsername,
    })
  );

  return true;
};
