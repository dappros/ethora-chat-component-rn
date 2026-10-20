import { store } from '../roomStore';
import { acceptIncomingCall, setIncomingCallToken } from '../roomStore/callSlice';
import { endSystemIncomingCall } from '../components/VideoCalls/systemCall';
import { declineActiveCallWhenOnline } from '../components/VideoCalls/callActions';
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

  // Already ringing or in this exact call (the push raced the stanza, or
  // two pushes arrived). Re-dispatching would reset startedAt and restart
  // the ring, so leave the existing call alone.
  const current = state.call;
  if (current.phase !== 'idle') {
    const sameCall =
      (!!parsed.callId && parsed.callId === current.callId) ||
      (!!parsed.roomBareName && parsed.roomBareName === current.roomBareName);
    if (sameCall) {
      applyIntent(intent);
      return true;
    }
    if (current.phase === 'in-call') {
      // Busy with another call: no second ring.
      endSystemIncomingCall(parsed.callId);
      return false;
    }
  }

  // Without a LiveKit token there is nothing to accept: the push is only
  // an alert. Ringing anyway would give the user an Accept button that
  // cannot work, so treat it as handled and let the stanza (once the
  // socket is back up) open the real ring screen.
  if (!parsed.token) {
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

  store.dispatch(
    setIncomingCallToken({
      roomJid,
      roomName: parsed.callerName || resolved?.title || resolved?.name || null,
      roomBareName: parsed.roomBareName,
      token: parsed.token,
      kind: parsed.kind,
      callId: parsed.callId,
      peerXmppUsername: parsed.callerXmppUsername,
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
