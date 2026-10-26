import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type {
  P2PCallController,
  P2PSnapshot,
} from '../../calls/p2p/P2PCallController';
import { loadLiveKit } from './livekitRuntime';
import { translateCallString } from './callActions';
import { CallSessionSnapshot, IDLE_SESSION } from './callSessionTypes';

/**
 * The peer to peer call, seen through the same snapshot the LiveKit session
 * produces (callSessionController.ts), so the call screen, the minimized
 * strip, CallKit and the ongoing-call notification serve both transports.
 *
 * Like the LiveKit session it is owned outside React: P2PCallRunner binds the
 * controller of the current call here and unbinds it when the call stops.
 * Video is handed to the UI as a `{ streamURL, key }` handle for RTCView;
 * remote audio needs nothing, react-native-webrtc plays it on its own.
 */

// The controller words its failures in English (it is shared with the web
// SDK); the strings the user can see are mapped to the translated tables here.
const MESSAGE_KEYS: Record<string, string> = {
  'Camera or microphone permission denied': 'call.error.deviceBlocked',
  'No camera or microphone found on this device': 'call.error.deviceNotFound',
  'Your camera or microphone is already in use by another app':
    'call.error.deviceInUse',
  'Could not access your camera or microphone': 'call.error.deviceGeneric',
  'The other person could not access their camera or microphone':
    'call.error.p2pPeerMedia',
  'The call could not be connected': 'call.error.p2pConnect',
  'Could not connect the call': 'call.error.p2pConnect',
  'Could not start the call': 'call.error.p2pSetup',
  'Could not set up the call': 'call.error.p2pSetup',
  'Connection lost': 'call.error.p2pConnectionLost',
};

/** Translated version of a message the p2p controller produced. */
export const localizeP2PMessage = (message: string): string => {
  const key = MESSAGE_KEYS[message];
  return key ? translateCallString(key) : message;
};

interface Bound {
  controller: P2PCallController;
  kind: 'audio' | 'video';
  unsubscribe: () => void;
  /** First time media flowed; kept across reconnects. */
  connectedAt: number | null;
}

let bound: Bound | null = null;
let snapshot: CallSessionSnapshot = IDLE_SESSION;
let speakerOn = false;
let facingMode: 'user' | 'environment' = 'user';
let remoteHandle: any = null;
let localHandle: any = null;
const listeners = new Set<() => void>();

const emit = (next: CallSessionSnapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getP2PSessionSnapshot = (): CallSessionSnapshot => snapshot;

export const isP2PSessionActive = (): boolean => bound !== null;

export const useP2PSession = (): CallSessionSnapshot =>
  useSyncExternalStore(subscribe, getP2PSessionSnapshot, getP2PSessionSnapshot);

// A video handle for RTCView. RTCView binds to the stream's video track when
// the stream URL is set, so the key carries the track ids: a camera that is
// turned off and on again, or a remote video that arrives late, remounts the
// view onto the stream as it is now.
const videoHandle = (
  stream: MediaStream | null,
  previous: any
): { handle: any } => {
  const tracks = stream?.getVideoTracks?.() || [];
  if (!stream || tracks.length === 0) return { handle: null };
  const streamURL = String((stream as any).toURL?.() ?? '');
  if (!streamURL) return { handle: null };
  const key = `${streamURL}|${tracks.map((t) => t.id).join(',')}`;
  if (previous && previous.key === key) return { handle: previous };
  return { handle: { streamURL, key } };
};

const connectedStatus = (status: P2PSnapshot['status']): boolean =>
  status === 'waiting' || status === 'connected';

const build = (current: Bound, p2p: P2PSnapshot): CallSessionSnapshot => {
  const hasMedia = p2p.status === 'connected' || p2p.status === 'reconnecting';
  if (hasMedia && current.connectedAt === null) {
    current.connectedAt = Date.now();
  }

  const remote = videoHandle(
    p2p.remoteVideoLive ? p2p.remoteStream : null,
    remoteHandle
  );
  remoteHandle = remote.handle;
  const local = videoHandle(
    current.kind === 'video' && p2p.camEnabled ? p2p.localStream : null,
    localHandle
  );
  localHandle = local.handle;

  return {
    ...IDLE_SESSION,
    active: true,
    // "Connected" here means the offer is out or media flows, i.e. the
    // screen may say "waiting for the other person" instead of "connecting".
    connected: connectedStatus(p2p.status),
    deviceError: p2p.notice ? localizeP2PMessage(p2p.notice) : null,
    micOn: p2p.micEnabled,
    cameraOn: current.kind === 'video' && p2p.camEnabled,
    speakerOn,
    facingMode,
    remoteVideo: remoteHandle,
    localVideo: localHandle,
    remoteJoined: hasMedia,
    anchorAt: current.connectedAt,
    reconnecting: p2p.status === 'reconnecting',
  };
};

const refresh = () => {
  if (!bound) return;
  emit(build(bound, bound.controller.getSnapshot()));
};

/**
 * Show `controller`'s call through the session snapshot. Returns the unbind
 * function. Only one call is ever bound; binding another replaces it.
 */
export const bindP2PSession = (
  controller: P2PCallController,
  kind: 'audio' | 'video'
): (() => void) => {
  if (bound?.controller === controller) return unbindFor(controller);
  if (bound) unbindP2PSession();
  speakerOn = kind === 'video';
  facingMode = 'user';
  remoteHandle = null;
  localHandle = null;
  const current: Bound = {
    controller,
    kind,
    unsubscribe: controller.subscribe(refresh),
    connectedAt: null,
  };
  bound = current;
  refresh();
  return unbindFor(controller);
};

const unbindFor = (controller: P2PCallController) => () => {
  if (bound?.controller === controller) unbindP2PSession();
};

export const unbindP2PSession = (): void => {
  const current = bound;
  if (!current) return;
  bound = null;
  current.unsubscribe();
  remoteHandle = null;
  localHandle = null;
  try {
    void loadLiveKit()?.AudioSession?.stopAudioSession();
  } catch {
    // Never let teardown throw.
  }
  emit(IDLE_SESSION);
};

/**
 * Claim the native audio session before the connection comes up. Without
 * this the first seconds route to the earpiece on Android even for a video
 * call (the LiveKit session does the same before `room.connect`). Best
 * effort: a call answered from CallKit already owns the iOS session.
 */
export const prepareP2PAudio = async (
  kind: 'audio' | 'video'
): Promise<void> => {
  const audio = loadLiveKit()?.AudioSession;
  if (!audio) return;
  try {
    await audio.startAudioSession();
  } catch {
    // CallKit activates the iOS audio session itself.
  }
  try {
    await audio.setAppleAudioConfiguration?.({
      audioCategory: 'playAndRecord',
      audioCategoryOptions: kind === 'video' ? ['defaultToSpeaker'] : [],
      audioMode: kind === 'video' ? 'videoChat' : 'voiceChat',
    });
  } catch {
    // iOS-only helper.
  }
};

/** Audio session first, then media and the offer / answer. */
export const startP2PController = async (
  controller: P2PCallController,
  kind: 'audio' | 'video'
): Promise<void> => {
  await prepareP2PAudio(kind);
  if (bound?.controller !== controller) {
    // The call was cancelled while the audio session was coming up.
    try {
      void loadLiveKit()?.AudioSession?.stopAudioSession();
    } catch {
      // Never let teardown throw.
    }
    return;
  }
  await controller.start();
};

// ---- controls -----------------------------------------------------------

export const setP2PMicEnabled = (next: boolean): void => {
  const current = bound;
  if (!current || current.controller.getSnapshot().micEnabled === next) return;
  current.controller.toggleMic();
};

export const toggleP2PCamera = async (): Promise<void> => {
  const current = bound;
  if (!current) return;
  await current.controller.toggleCamera();
};

/** Front / back camera of the live local video track. */
export const switchP2PCamera = (): void => {
  const current = bound;
  if (!current) return;
  const track: any = current.controller.getSnapshot().localStream?.getVideoTracks?.()[0];
  if (!track || typeof track._switchCamera !== 'function') return;
  try {
    track._switchCamera();
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    refresh();
  } catch {
    // The camera stays where it was.
  }
};

export const toggleP2PSpeaker = async (): Promise<void> => {
  const current = bound;
  const audio = loadLiveKit()?.AudioSession;
  if (!current || !audio) return;
  const next = !speakerOn;
  speakerOn = next;
  refresh();
  try {
    if (Platform.OS === 'android') {
      await audio.selectAudioOutput(next ? 'speaker' : 'earpiece');
    } else {
      await audio.setAppleAudioConfiguration?.({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: next ? ['defaultToSpeaker'] : [],
        audioMode: next ? 'videoChat' : 'voiceChat',
      });
    }
  } catch {
    speakerOn = !next;
    refresh();
  }
};

export const dismissP2PDeviceError = (): void => {
  bound?.controller.dismissNotice();
};

/** Reset module state. Test seam only. */
export const __resetP2PCallSessionForTests = (): void => {
  unbindP2PSession();
  speakerOn = false;
  facingMode = 'user';
};
