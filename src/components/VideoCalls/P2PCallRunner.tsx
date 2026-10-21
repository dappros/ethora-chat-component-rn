import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, store } from '../../roomStore';
import { endCall, setCallError, setCallPhase } from '../../roomStore/callSlice';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import {
  P2PCallController,
  remoteEndNotice,
} from '../../calls/p2p/P2PCallController';
import {
  acquireP2PController,
  createNativeP2PDeps,
  p2pInbox,
  releaseP2PController,
} from '../../calls/p2p/p2pRuntime';
import { isP2PAvailable } from '../../calls/p2p/webrtcRuntime';
import {
  reportCallConnected,
  reportCallDeclined,
  reportCallEnded,
  reportCallRinging,
} from '../../networking/api-requests/callState.api';
import { translateCallString } from './callActions';
import {
  bindP2PSession,
  localizeP2PMessage,
  startP2PController,
} from './p2pCallSession';

// Headless owner of the p2p controller for the call in the redux call slice.
// It builds the controller when a p2p call needs one, wires its events back
// into the slice, and releases it on EVERY way a call can stop (the phase goes
// idle or error, the call changes, the overlay unmounts), which is what keeps
// camera, microphone and the peer connection from leaking.
//
//   caller: the controller exists from the moment the create response says
//           `p2p` and starts at once (media, offer);
//   callee: the controller exists while the incoming call rings, so the
//           caller's offer / candidates / cancel are caught, but it only
//           starts (media, answer) after the user accepts.
//
// RN specific: the call also rings from a VoIP push, with the app still
// starting. The caller keeps re-sending its offer for the whole ring window
// (longer than on web) because a cold-started callee may need several seconds
// to bring the XMPP socket up.

const RN_OFFER_RESEND_MS = [4_000, 10_000, 18_000, 26_000];

const isCurrentCall = (callId: string): boolean => {
  const current = store.getState().call;
  return current.phase !== 'idle' && current.callId === callId;
};

export const P2PCallRunner: React.FC = () => {
  const dispatch = useDispatch();
  const call = useSelector((state: RootState) => state.call);
  const { config } = useChatSettingState();
  const videoCalls = config?.videoCalls;
  const enabled = videoCalls?.enabled === true;

  const callId = call.callId;
  const isIncoming = call.direction === 'incoming';
  const wantsController =
    enabled &&
    call.mode === 'p2p' &&
    !!callId &&
    (isIncoming
      ? call.phase === 'ringing-incoming' ||
        call.phase === 'connecting' ||
        call.phase === 'in-call'
      : call.direction === 'outgoing' &&
        call.iceServers !== null &&
        (call.phase === 'requesting' ||
          call.phase === 'connecting' ||
          call.phase === 'in-call'));
  // The callee waits on the ring screen; everyone else starts right away.
  const shouldStart = wantsController && !(isIncoming && call.phase === 'ringing-incoming');

  // Latest config values for the controller without re-running the effect.
  const optionsRef = useRef({
    startWithMicOn: videoCalls?.startWithMicOn,
    startWithCameraOn: videoCalls?.startWithCameraOn,
  });
  optionsRef.current = {
    startWithMicOn: videoCalls?.startWithMicOn,
    startWithCameraOn: videoCalls?.startWithCameraOn,
  };

  useEffect(() => {
    if (!wantsController || !callId) return;

    if (!isP2PAvailable()) {
      // The WebRTC package is not in this build: nothing can carry the call.
      // A callee also tells the caller instead of letting them ring on.
      if (store.getState().call.direction === 'incoming') {
        reportCallDeclined(callId);
      }
      dispatch(setCallError(translateCallString('call.error.sdkMissing')));
      return;
    }

    const snapshot = store.getState().call;
    const peer = String(snapshot.peerXmppUsername || '').trim();
    const role = snapshot.direction === 'incoming' ? 'callee' : 'caller';
    if (!peer) {
      // Without the peer's address there is nobody to signal.
      dispatch(setCallError(translateCallString('call.error.p2pNoPeer')));
      return;
    }

    const controller = acquireP2PController(callId, () => {
      const peerLocal = peer.split('@')[0];
      return new P2PCallController(
        {
          callId,
          role,
          kind: snapshot.kind,
          peerLocal,
          iceServers: snapshot.iceServers || [],
          startWithMicOn: optionsRef.current.startWithMicOn,
          startWithCameraOn: optionsRef.current.startWithCameraOn,
        },
        createNativeP2PDeps({ callId, peerXmppUsername: peer }),
        {
          onNegotiated: () => {
            if (
              role === 'caller' &&
              isCurrentCall(callId) &&
              store.getState().call.phase === 'requesting'
            ) {
              dispatch(setCallPhase('connecting'));
            }
          },
          onConnected: () => {
            if (!isCurrentCall(callId)) return;
            dispatch(setCallPhase('in-call'));
            // One side is enough to start the server-side call timer.
            if (role === 'caller') reportCallConnected(callId);
          },
          onRemoteEnd: (reason) => {
            if (!isCurrentCall(callId)) return;
            const notice = remoteEndNotice(reason);
            dispatch(notice ? setCallError(localizeP2PMessage(notice)) : endCall());
          },
          onFailed: (message) => {
            if (isCurrentCall(callId)) {
              dispatch(setCallError(localizeP2PMessage(message)));
            }
          },
          // Whatever ended it, tell the server the call is over (idempotent, so
          // it does not matter that the peer reports it too). A callee that
          // never accepted ends through the decline report instead.
          onDisposed: ({ started }) => {
            if (started) reportCallEnded(callId);
          },
        },
        { offerResendMs: RN_OFFER_RESEND_MS }
      );
    });

    const unbind = bindP2PSession(controller, snapshot.kind);
    const detach = p2pInbox.attach(callId, (signal) =>
      controller.receive(signal)
    );
    if (shouldStart) void startP2PController(controller, snapshot.kind);

    return () => {
      detach();
      unbind();
      releaseP2PController(callId);
    };
  }, [wantsController, shouldStart, callId, dispatch]);

  // Callee: the incoming UI is on screen, let the server (and so the caller)
  // know the phone is ringing. Once per call.
  const ringingReportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      enabled &&
      call.mode === 'p2p' &&
      isIncoming &&
      call.phase === 'ringing-incoming' &&
      callId &&
      ringingReportedRef.current !== callId
    ) {
      ringingReportedRef.current = callId;
      reportCallRinging(callId);
    }
  }, [enabled, call.mode, isIncoming, call.phase, callId]);

  return null;
};
