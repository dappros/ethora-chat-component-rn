import { store } from '../roomStore';
import { acceptIncomingCall, setIncomingCallToken } from '../roomStore/callSlice';
import { endSystemIncomingCall } from '../components/VideoCalls/systemCall';
import { declineActiveCallWhenOnline } from '../components/VideoCalls/callActions';
import { reportCallDeclined, reportCallEnded } from '../networking/api-requests/callState.api';
import { sendCallStateSignal } from '../networking/callTokenStanza';
import { decideIncomingWhileBusy } from '../calls/callMode';
import { busySnapshot } from '../calls/callBusy';
import { isCallPush, parseCallPush } from './callPush';
import { normalizeRoomJid } from './normalizeRoomJid';

const PENDING_CALL_PUSH_TTL_MS = 60_000;


export type CallPushIntent = 'ring' | 'answer' | 'decline';

let pendingPush: { data: Record<string, any>; intent: CallPushIntent; at: number } | null = null;
let unwatch: (() => void) | null = null;

const trace = (...args: unknown[]) => {
  if (__DEV__) {console.log('[calls] push:', ...args);}
};

const callsConfigured = (): boolean =>
  store.getState().chatSettingStore.config?.videoCalls !== undefined;

const holdUntilConfigured = (data: Record<string, any>, intent: CallPushIntent): void => {
  pendingPush = { data, intent, at: Date.now() };
  if (unwatch) {return;}
  unwatch = store.subscribe(() => {
    if (!callsConfigured()) {return;}
    unwatch?.();
    unwatch = null;
    const held = pendingPush;
    pendingPush = null;
    if (!held) {return;}
    if (Date.now() - held.at > PENDING_CALL_PUSH_TTL_MS) {
      trace('held call push expired');
      endSystemIncomingCall(parseCallPush(held.data).callId);
      return;
    }
    ringFromPush(held.data, held.intent);
  });
};

const applyIntent = (intent: CallPushIntent): void => {
  const call = store.getState().call;
  if (call.direction !== 'incoming' || call.phase !== 'ringing-incoming') {return;}
  if (intent === 'answer') {store.dispatch(acceptIncomingCall());}
  if (intent === 'decline') {declineActiveCallWhenOnline();}
};

const ringFromPush = (data: Record<string, any>, intent: CallPushIntent): boolean => {
  const parsed = parseCallPush(data);
  const state = store.getState();

  // Calls off in this deployment: swallow the push rather than ringing a
  // screen the host never opted into.
  if (state.chatSettingStore.config?.videoCalls?.enabled !== true) {
    trace('calls are off, dropping', parsed.callId);
    endSystemIncomingCall(parsed.callId);
    return false;
  }

  const isP2P = parsed.mode === 'p2p';

  // A peer to peer call is correlated by its callId alone (there is no room
  // token), and one call at a time: decided the way the call-token stanza
  // decides it. The caller is told when we cannot take it.
  if (isP2P) {
    if (!parsed.callId) {
      trace('p2p call push without a callId, dropping');
      endSystemIncomingCall(parsed.callId);
      return false;
    }
    const decision = decideIncomingWhileBusy(busySnapshot(state.call), {
      mode: 'p2p',
      callId: parsed.callId,
      roomBareName: parsed.roomBareName,
    });
    if (decision === 'duplicate') {
      applyIntent(intent);
      return true;
    }
    if (decision === 'busy' || decision === 'replace') {
      trace('busy, declining p2p call', parsed.callId);
      reportCallDeclined(parsed.callId);
      sendCallStateSignal('declined', {
        peerXmppUsername: parsed.callerXmppUsername,
        callId: parsed.callId,
        roomBareName: parsed.roomBareName,
      });
      endSystemIncomingCall(parsed.callId);
      return false;
    }
    if (decision === 'glare-keep') {
      endSystemIncomingCall(parsed.callId);
      return false;
    }
    if (decision === 'glare-yield') {
      // Both sides dialled at once and theirs has the smaller id: drop ours.
      sendCallStateSignal('cancelled');
      reportCallEnded(state.call.callId);
    }
  }

  // Already ringing or in this exact call (the push raced the stanza, or
  // two pushes arrived). Re-dispatching would reset startedAt and restart
  // the ring, so leave the existing call alone.
  const current = state.call;
  if (!isP2P && current.phase !== 'idle') {
    const sameCall =
      (!!parsed.callId && parsed.callId === current.callId) ||
      (!!parsed.roomBareName && parsed.roomBareName === current.roomBareName);
    if (sameCall) {
      applyIntent(intent);
      return true;
    }
    if (current.phase === 'in-call' || current.mode === 'p2p') {
      // Busy with another call: no second ring. (A p2p call is never
      // replaced by a LiveKit one, whatever phase it is in.)
      endSystemIncomingCall(parsed.callId);
      return false;
    }
  }

  // Without a LiveKit token there is nothing to accept: the push is only
  // an alert. Ringing anyway would give the user an Accept button that
  // cannot work, so treat it as handled and let the stanza (once the
  // socket is back up) open the real ring screen.
  // A p2p call carries no token by design: it is answered over XMPP.
  if (!parsed.token && !isP2P) {
    endSystemIncomingCall(parsed.callId);
    return false;
  }

  // Resolve the full room JID from the local room map. The push carries
  // the bare name; callSlice and the hangup signal both want the JID.
  const rooms = state.rooms.rooms || {};
  const resolved = Object.values(rooms).find(
    (room: any) =>
      (room?.jid || '').split('@')[0] === parsed.roomBareName ||
      room?.jid === parsed.roomRef
  ) as { jid?: string; name?: string; title?: string } | undefined;

  const conference =
    state.chatSettingStore.config?.xmppSettings?.conference || '';
  const fromRef = parsed.roomRef
    ? normalizeRoomJid(parsed.roomRef, conference)
    : '';
  const roomJid = resolved?.jid || (fromRef.includes('@') ? fromRef : '');
  if (!roomJid) {
    trace('no room for call push', parsed.roomRef);
    endSystemIncomingCall(parsed.callId);
    return false;
  }

  // In a group the call is the ROOM and the caller is a separate line; a
  // 1:1 call is named after the caller.
  const roomTitle = resolved?.title || resolved?.name || null;
  store.dispatch(
    setIncomingCallToken({
      roomJid,
      roomName: parsed.isGroup
        ? roomTitle
        : parsed.callerName || roomTitle,
      roomBareName: parsed.roomBareName,
      token: parsed.token || '',
      kind: parsed.kind,
      callId: parsed.callId,
      // A group has no single peer to signal.
      peerXmppUsername: parsed.isGroup ? null : parsed.callerXmppUsername,
      mode: parsed.mode,
      isGroup: parsed.isGroup,
      callerName: parsed.callerName,
      callerXmppUsername: parsed.callerXmppUsername,
    })
  );
  trace('ringing', parsed.callId, intent);
  applyIntent(intent);
  return true;
};

export const handleCallPush = (
  data: Record<string, any> | null | undefined,
  intent: CallPushIntent = 'ring'
): boolean => {
  if (!isCallPush(data)) {
    return false;
  }
  if (!callsConfigured()) {
    trace('holding call push until the chat is configured');
    holdUntilConfigured(data as Record<string, any>, intent);
    return true;
  }
  ringFromPush(data as Record<string, any>, intent);
  return true;
};

export const answerCallFromPush = (
  data: Record<string, any> | null | undefined
): boolean => handleCallPush(data, 'answer');

export const declineCallFromPush = (
  data: Record<string, any> | null | undefined
): boolean => handleCallPush(data, 'decline');

export const __resetCallPushForTests = (): void => {
  unwatch?.();
  unwatch = null;
  pendingPush = null;
};
