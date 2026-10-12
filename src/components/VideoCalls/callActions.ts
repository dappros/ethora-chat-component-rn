import { store } from '../../roomStore';
import { declineIncomingCall, endCall } from '../../roomStore/callSlice';
import { addRoomMessage } from '../../roomStore/roomsSlice';
import { buildLocalCallLogMessage } from '../../helpers/callLogMessage';
import {
  CallSignalState,
  sendCallStateSignal,
} from '../../networking/callTokenStanza';
import { translateKey } from '../../i18n/strings';

/**
 * Call teardown that doesn't need a mounted component.
 *
 * It used to live inside VideoCallOverlay, which meant only a rendered
 * overlay could end a call. The LiveKit session now outlives the UI
 * (callSessionController.ts), so the session's own "peer left" and
 * "disconnected" events need the same teardown, with the same local log
 * entry and the same signal to the peer.
 */
export const terminateActiveCall = (state: CallSignalState): void => {
  // Write a local "call ended" log entry BEFORE endCall() wipes the call
  // slice. The authoritative entry is a server call-state broadcast, but
  // that isn't guaranteed to arrive, so we synthesize our own. It's
  // deduped against any server copy by callId in addRoomMessage.
  const snap = store.getState().call;
  if (snap.phase === 'idle') {return;}
  if (snap.roomJid && (snap.callId || snap.connectedAt)) {
    const durationMs = snap.connectedAt
      ? Math.max(0, Date.now() - snap.connectedAt)
      : 0;
    store.dispatch(
      addRoomMessage({
        roomJID: snap.roomJid,
        message: buildLocalCallLogMessage({
          callId: snap.callId || '',
          direction: snap.direction === 'incoming' ? 'incoming' : 'outgoing',
          durationMs,
          kind: snap.kind === 'audio' ? 'audio' : 'video',
          selfXmppUsername:
            store.getState().chatSettingStore.user?.xmppUsername || '',
        }),
      })
    );
  }
  sendCallStateSignal(state);
  store.dispatch(endCall());
};

export const declineActiveCall = (): void => {
  sendCallStateSignal('declined');
  store.dispatch(declineIncomingCall());
};

/** `t` for code outside React, resolved by the same rule as useT. */
export const translateCallString = (
  key: string,
  vars?: Record<string, string | number>
): string => {
  const settings = store.getState().chatSettingStore as any;
  const locale =
    settings?.uiLocale || settings?.config?.i18n?.locale || settings?.langSource;
  return translateKey(key, locale, settings?.config?.i18n?.strings, vars);
};
