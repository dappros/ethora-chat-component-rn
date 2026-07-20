import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, store } from '../../roomStore';
import { acceptIncomingCall, declineIncomingCall } from '../../roomStore/callSlice';
import { sendCallStateSignal } from '../../networking/callTokenStanza';

/**
 * Native incoming-call UI (Android ConnectionService / iOS CallKit) via
 * the optional `react-native-callkeep` package.
 *
 * Why optional: CallKeep pulls a telecom-framework dependency into the
 * host app and, on iOS, is only half a solution without PushKit. It is
 * loaded lazily exactly like the LiveKit packages, so hosts that don't
 * install it get the plain in-app ring screen and nothing breaks.
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

export const useCallKeep = (): void => {
  const dispatch = useDispatch();
  const call = useSelector((state: RootState) => state.call);
  const callKeep = useMemo(() => loadCallKeep(), []);
  const activeUuidRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  // One-time native setup.
  useEffect(() => {
    if (!callKeep) {return;}
    let cancelled = false;

    (async () => {
      try {
        await callKeep.setup({
          ios: {
            appName: 'Ethora',
            supportsVideo: true,
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
        readyRef.current = true;
      } catch {
        // Host didn't grant phone-account permission, or the module isn't
        // linked. The in-app ring screen still works, so stay quiet.
        readyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [callKeep]);

  // Bridge native answer/end actions back into Redux.
  useEffect(() => {
    if (!callKeep) {return;}

    const onAnswer = () => {
      // The user answered from the system screen, which on Android may
      // mean the app was not even in the foreground.
      callKeep.backToForeground?.();
      if (store.getState().call.direction === 'incoming') {
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
      }
    };

    callKeep.addEventListener('answerCall', onAnswer);
    callKeep.addEventListener('endCall', onEnd);

    return () => {
      callKeep.removeEventListener('answerCall');
      callKeep.removeEventListener('endCall');
    };
  }, [callKeep, dispatch]);

  // Show / dismiss the native screen as the call state changes.
  useEffect(() => {
    if (!callKeep || !readyRef.current) {return;}

    const isRinging =
      call.direction === 'incoming' && call.phase === 'ringing-incoming';

    if (isRinging && !activeUuidRef.current) {
      const uuid = toUuid(call.callId || call.roomJid || String(Date.now()));
      activeUuidRef.current = uuid;
      try {
        callKeep.displayIncomingCall(
          uuid,
          call.peerXmppUsername || call.roomName || 'Ethora',
          call.roomName || undefined,
          'generic',
          call.kind === 'video'
        );
      } catch {
        activeUuidRef.current = null;
      }
      return;
    }

    // Any exit from ringing (answered in-app, declined, peer cancelled)
    // must tear the system screen down or it hangs around ringing.
    if (!isRinging && activeUuidRef.current && call.phase !== 'connecting' && call.phase !== 'in-call') {
      try {
        callKeep.endCall(activeUuidRef.current);
      } catch {
        // Screen already gone.
      }
      activeUuidRef.current = null;
    }

    if (call.phase === 'idle' && activeUuidRef.current) {
      try {
        callKeep.endCall(activeUuidRef.current);
      } catch {
        // noop
      }
      activeUuidRef.current = null;
    }
  }, [
    callKeep,
    call.direction,
    call.phase,
    call.callId,
    call.roomJid,
    call.roomName,
    call.peerXmppUsername,
    call.kind,
  ]);

  // Nothing to clean up on unmount beyond the active screen: this hook
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

  // iOS-only note kept as a runtime no-op so the import isn't unused when
  // the platform check is tree-shaken in release builds.
  void Platform.OS;
};
