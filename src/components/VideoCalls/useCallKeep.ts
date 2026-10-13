import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, store } from '../../roomStore';
import { acceptIncomingCall, declineIncomingCall } from '../../roomStore/callSlice';
import { sendCallStateSignal } from '../../networking/callTokenStanza';
import { terminateActiveCall } from './callActions';
import { setCallMicEnabled, useCallSession } from './callSessionController';
import { loadLiveKit } from './livekitRuntime';
import { setCallSystemRinging } from './callUiStore';

/**
 * Native incoming-call UI (Android ConnectionService / iOS CallKit) via
 * the optional `react-native-callkeep` package.
 *
 * Why optional: CallKeep pulls a telecom-framework dependency into the
 * host app and, on iOS, is only half a solution without PushKit. It is
 * loaded lazily exactly like the LiveKit packages, so hosts that don't
 * install it get the plain in-app ring screen and nothing breaks.
 *
 * On iOS every call, incoming or outgoing, is also reported to CallKit for
 * as long as it lasts. That is what puts it in the Dynamic Island / the
 * green status-bar pill when the app is in the background, with the
 * system's own mute and end buttons, and what keeps the call's audio
 * running in the background.
 *
 * Platform reality, stated plainly:
 *  - Android: full value. A ConnectionService call shows the system
 *    incoming-call screen over the lock screen.
 *  - iOS: this only fires while the app is running. A CallKit screen from
 *    a killed app requires a VoIP push over PushKit, which needs a
 *    separate Apple VoIP certificate and a separate send path on the
 *    backend (not FCM). Until that exists, iOS falls back to the regular
 *    data push and the in-app ring screen.
 */

interface CallKeepModule {
  setup: (options: any) => Promise<void>;
  displayIncomingCall: (
    uuid: string,
    handle: string,
    localizedCallerName?: string,
    handleType?: string,
    hasVideo?: boolean
  ) => void;
  endCall: (uuid: string) => void;
  endAllCalls: () => void;
  startCall?: (
    uuid: string,
    handle: string,
    contactIdentifier?: string,
    handleType?: string,
    hasVideo?: boolean
  ) => void;
  answerIncomingCall?: (uuid: string) => void;
  reportConnectingOutgoingCallWithUUID?: (uuid: string) => void;
  reportConnectedOutgoingCallWithUUID?: (uuid: string) => void;
  reportEndCallWithUUID?: (uuid: string, reason: number) => void;
  setMutedCall?: (uuid: string, muted: boolean) => void;
  addEventListener: (event: string, handler: (payload: any) => void) => void;
  removeEventListener: (event: string) => void;
  setAvailable?: (available: boolean) => void;
  backToForeground?: () => void;
}

let cachedCallKeep: CallKeepModule | null | undefined;

export const loadCallKeep = (): CallKeepModule | null => {
  if (cachedCallKeep !== undefined) {
    return cachedCallKeep;
  }
  try {
    // The JS package being installed does NOT mean the native side is
    // linked: a host can `npm i react-native-callkeep` and skip
    // `pod install`, or (very common in this repo) node_modules can carry
    // it over from another branch whose build did link it. In that state
    // requiring the package builds a `new NativeEventEmitter(null)` at
    // module scope, which throws an invariant that RN surfaces as an
    // uncaught redbox on every render of the call overlay — the whole app
    // becomes unusable over a feature the host never switched on.
    // Probing NativeModules first keeps the optional dependency genuinely
    // optional: no native module => behave exactly as if it isn't installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native');
    if (!NativeModules?.RNCallKeep) {
      cachedCallKeep = null;
      return cachedCallKeep;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-callkeep');
    cachedCallKeep = (mod?.default || mod) as CallKeepModule;
  } catch {
    cachedCallKeep = null;
  }
  return cachedCallKeep;
};

// CallKeep identifies calls by UUID. Our callIds aren't UUIDs, so derive a
// stable v4-shaped string from the callId: same call always maps to the
// same UUID, which is what endCall() needs to dismiss the right screen.
const toUuid = (seed: string): string => {
  let hash = 0x811c9dc5;
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    const ch = seed.charCodeAt(i % Math.max(1, seed.length)) + i;
    hash ^= ch;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    bytes.push(hash & 0xff);
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
};

const trace = (...args: unknown[]) => {
  if (__DEV__) {console.log('[calls] CallKit:', ...args);}
};

export const useCallKeep = (): void => {
  const dispatch = useDispatch();
  const call = useSelector((state: RootState) => state.call);
  const session = useCallSession();
  const callKeep = useMemo(() => loadCallKeep(), []);
  const [ready, setReady] = useState(false);
  const activeUuidRef = useRef<string | null>(null);
  // The CallKit call has been answered (from the system screen or in-app).
  const answeredRef = useRef(false);
  const outgoingReportedRef = useRef<'none' | 'connecting' | 'connected'>('none');
  const isIOS = Platform.OS === 'ios';

  // One-time native setup.
  useEffect(() => {
    if (!callKeep) {
      if (isIOS) {
        // The usual reason for "no Dynamic Island": the JS package is there
        // but the binary was built without the RNCallKeep pod.
        trace('unavailable (react-native-callkeep is not linked in this build)');
      }
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        await callKeep.setup({
          ios: {
            appName: 'Ethora',
            supportsVideo: true,
            maximumCallGroups: '1',
            maximumCallsPerCallGroup: '1',
            // Our calls are not phone calls: keep them out of the Phone
            // app's Recents, whose entries would dial back into nowhere.
            includesCallsInRecents: false,
          },
          android: {
            alertTitle: 'Permissions required',
            alertDescription:
              'This application needs to access your phone accounts to show incoming calls',
            cancelButton: 'Cancel',
            okButton: 'ok',
            additionalPermissions: [],
            foregroundService: {
              channelId: 'com.ethora.chat.calls',
              channelName: 'Incoming calls',
              notificationTitle: 'Call in progress',
            },
          },
        });
        if (cancelled) {return;}
        callKeep.setAvailable?.(true);
        trace('ready');
        setReady(true);
      } catch (error) {
        trace('setup failed', error);
        // Host didn't grant phone-account permission, or the module isn't
        // linked. The in-app ring screen still works, so stay quiet.
        setReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [callKeep, isIOS]);

  // Bridge native actions back into the call.
  useEffect(() => {
    if (!callKeep) {return;}

    const onAnswer = () => {
      answeredRef.current = true;
      // The user answered from the system screen, which on Android may
      // mean the app was not even in the foreground.
      callKeep.backToForeground?.();
      // Only from the ring: CallKit also reports the answer we make on its
      // behalf after an in-app accept, and re-accepting then would drop an
      // in-progress call back to 'connecting'.
      const current = store.getState().call;
      if (current.direction === 'incoming' && current.phase === 'ringing-incoming') {
        dispatch(acceptIncomingCall());
      }
    };

    const onEnd = () => {
      const snapshot = store.getState().call;
      if (snapshot.phase === 'idle') {return;}
      if (
        snapshot.direction === 'incoming' &&
        snapshot.phase === 'ringing-incoming'
      ) {
        sendCallStateSignal('declined');
        dispatch(declineIncomingCall());
        return;
      }
      // Ended from the Dynamic Island, the lock screen or a headset.
      if (snapshot.phase === 'error') {return;}
      terminateActiveCall(snapshot.phase === 'requesting' ? 'cancelled' : 'ended');
    };

    // The system mute button (Dynamic Island, lock screen, CarPlay).
    const onMuted = ({ muted }: { muted: boolean }) => {
      void setCallMicEnabled(!muted);
    };

    // Another call (e.g. a phone call) put ours on hold: stop sending audio.
    const onHold = ({ hold }: { hold: boolean }) => {
      if (hold) {void setCallMicEnabled(false);}
    };

    // CallKit owns the iOS audio session: WebRTC may only start its audio
    // unit once CallKit has activated the session.
    const onAudioActivated = () => {
      try {
        loadLiveKit()?.RTCAudioSession?.audioSessionDidActivate?.();
      } catch {
        // Older webrtc builds manage the session on their own.
      }
    };
    const onAudioDeactivated = () => {
      try {
        loadLiveKit()?.RTCAudioSession?.audioSessionDidDeactivate?.();
      } catch {
        // noop
      }
    };

    callKeep.addEventListener('answerCall', onAnswer);
    callKeep.addEventListener('endCall', onEnd);
    callKeep.addEventListener('didPerformSetMutedCallAction', onMuted);
    callKeep.addEventListener('didToggleHoldCallAction', onHold);
    callKeep.addEventListener('didActivateAudioSession', onAudioActivated);
    // CallKit rejected or dropped our calls (e.g. a build without the voip
    // background mode): there is nothing to end any more.
    const onReset = () => {
      trace('provider reset');
    };
    callKeep.addEventListener('didResetProvider', onReset);
    // The system's verdict on displayIncomingCall ("Unentitled" means the
    // app lacks the voip background mode).
    const onDisplayed = ({ error, errorCode }: { error?: string; errorCode?: string }) => {
      trace('incoming call shown', error ? `failed: ${errorCode || ''} ${error}` : 'ok');
      // CallKit refused it (Do Not Disturb, unentitled...): bring the
      // in-app ring card back so the call can still be answered.
      if (error) {setCallSystemRinging(false);}
    };
    callKeep.addEventListener('didDisplayIncomingCall', onDisplayed);
    callKeep.addEventListener('didDeactivateAudioSession', onAudioDeactivated);

    return () => {
      callKeep.removeEventListener('answerCall');
      callKeep.removeEventListener('endCall');
      callKeep.removeEventListener('didPerformSetMutedCallAction');
      callKeep.removeEventListener('didToggleHoldCallAction');
      callKeep.removeEventListener('didActivateAudioSession');
      callKeep.removeEventListener('didDeactivateAudioSession');
      callKeep.removeEventListener('didResetProvider');
      callKeep.removeEventListener('didDisplayIncomingCall');
    };
  }, [callKeep, dispatch]);

  const displayName = call.roomName || 'Ethora';
  const isRinging =
    call.direction === 'incoming' && call.phase === 'ringing-incoming';
  const isLive = call.phase === 'connecting' || call.phase === 'in-call';
  const isOutgoing = call.direction === 'outgoing';
  const peerConnected = session.anchorAt !== null;

  // Report the call to the system as its state changes.
  useEffect(() => {
    if (!callKeep || !ready) {return;}

    const release = () => {
      if (!activeUuidRef.current) {return;}
      try {
        callKeep.endCall(activeUuidRef.current);
      } catch {
        // Screen already gone.
      }
      activeUuidRef.current = null;
      answeredRef.current = false;
      outgoingReportedRef.current = 'none';
    };

    if (call.phase === 'idle' || call.phase === 'error') {
      release();
      return;
    }

    if (isRinging) {
      if (activeUuidRef.current) {return;}
      const uuid = toUuid(call.callId || call.roomJid || String(Date.now()));
      activeUuidRef.current = uuid;
      answeredRef.current = false;
      // iOS: the system banner is the ring UI (Telegram-style); the in-app
      // card would only cover the screen under it.
      if (isIOS) {setCallSystemRinging(true);}
      try {
        callKeep.displayIncomingCall(
          uuid,
          displayName,
          displayName,
          'generic',
          call.kind === 'video'
        );
      } catch {
        activeUuidRef.current = null;
        setCallSystemRinging(false);
      }
      return;
    }

    // iOS: an outgoing call is a CallKit call from the first ring, so it
    // shows in the Dynamic Island even before the peer answers.
    if (isIOS && isOutgoing && !activeUuidRef.current && callKeep.startCall) {
      // Unique per call: CallKit refuses a UUID it has seen before, and
      // the callId only arrives with the token.
      const uuid = toUuid(`${call.roomJid || ''}|${call.startedAt || Date.now()}`);
      activeUuidRef.current = uuid;
      outgoingReportedRef.current = 'none';
      trace('startCall', uuid);
      try {
        callKeep.startCall(uuid, displayName, displayName, 'generic', call.kind === 'video');
      } catch {
        activeUuidRef.current = null;
      }
      return;
    }

    const uuid = activeUuidRef.current;
    if (!uuid) {return;}

    if (isIOS && isOutgoing) {
      if (peerConnected && outgoingReportedRef.current !== 'connected') {
        outgoingReportedRef.current = 'connected';
        callKeep.reportConnectedOutgoingCallWithUUID?.(uuid);
      } else if (
        isLive &&
        !peerConnected &&
        outgoingReportedRef.current === 'none'
      ) {
        outgoingReportedRef.current = 'connecting';
        callKeep.reportConnectingOutgoingCallWithUUID?.(uuid);
      }
      return;
    }

    // Incoming, accepted with the in-app button: tell CallKit, or its
    // screen keeps ringing on top of the call.
    if (isIOS && isLive && !answeredRef.current) {
      answeredRef.current = true;
      try {
        callKeep.answerIncomingCall?.(uuid);
      } catch {
        // noop
      }
    }
  }, [
    callKeep,
    ready,
    isIOS,
    isRinging,
    isLive,
    isOutgoing,
    peerConnected,
    displayName,
    call.phase,
    call.callId,
    call.roomJid,
    call.startedAt,
    call.kind,
  ]);

  // Keep the system mute button in step with ours.
  useEffect(() => {
    const uuid = activeUuidRef.current;
    if (!callKeep || !ready || !isIOS || !uuid || !isLive) {return;}
    try {
      callKeep.setMutedCall?.(uuid, !session.micOn);
    } catch {
      // noop
    }
  }, [callKeep, ready, isIOS, isLive, session.micOn]);

  // Nothing to clean up on unmount beyond the active call: this hook
  // lives for the lifetime of the provider.
  useEffect(
    () => () => {
      if (callKeep && activeUuidRef.current) {
        try {
          callKeep.endCall(activeUuidRef.current);
        } catch {
          // noop
        }
      }
    },
    [callKeep]
  );
};
