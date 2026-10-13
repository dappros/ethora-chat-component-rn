import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { store } from '../../roomStore';
import { setCallError, setCallPhase } from '../../roomStore/callSlice';
import { ensureLiveKitGlobals, loadLiveKit } from './livekitRuntime';
import { terminateActiveCall, translateCallString } from './callActions';

/**
 * The LiveKit connection of the current call, owned outside React.
 *
 * It used to live in VideoCallSession's effect, so the connection was as
 * long-lived as that component instance. Minimizing swapped the Modal for a
 * floating View, React remounted the session, the effect cleanup
 * disconnected, and the peer saw us leave (and hung up). The web SDK avoids
 * that by keeping one LiveKitRoom element mounted across both layouts; the
 * RN equivalent is to not tie the room to a component at all.
 *
 * Lifetime is driven by the call slice: a session exists while the call is
 * 'connecting' or 'in-call' with a token, and is torn down by a store
 * subscription the moment that stops being true (hangup, remote end,
 * logout's resetCall), whether or not any call UI is mounted. Components
 * only read the snapshot and call the controls.
 */

export interface CallSessionSnapshot {
  /** A LiveKit room exists for the current call. */
  active: boolean;
  connected: boolean;
  /** Translated, dismissible camera/mic problem. Never fails the call. */
  deviceError: string | null;
  micOn: boolean;
  cameraOn: boolean;
  speakerOn: boolean;
  /** Which camera the local video comes from; only the front one is mirrored. */
  facingMode: 'user' | 'environment';
  /**
   * Bumped whenever the local camera track is re-acquired, so the self view
   * can remount onto the new stream instead of holding the stopped one.
   */
  localVideoEpoch: number;
  /** `{ participant, publication, source }` for `<VideoTrack />`, live and unmuted only. */
  remoteVideo: any;
  localVideo: any;
  remoteName: string | null;
  remoteJoined: boolean;
  /** Peer joined but has no live microphone. */
  remoteMicMuted: boolean;
  /**
   * When the call truly connected: the later of the two LiveKit `joinedAt`
   * stamps. The server sets them, so both sides count from the same moment
   * (web's useSharedCallElapsed). Null until the peer is in.
   */
  anchorAt: number | null;
}

const IDLE: CallSessionSnapshot = {
  active: false,
  connected: false,
  deviceError: null,
  micOn: true,
  cameraOn: false,
  speakerOn: false,
  facingMode: 'user',
  localVideoEpoch: 0,
  remoteVideo: null,
  localVideo: null,
  remoteName: null,
  remoteJoined: false,
  remoteMicMuted: false,
  anchorAt: null,
};

interface Session {
  key: string;
  room: any;
  kind: 'audio' | 'video';
  disposed: boolean;
  everJoined: boolean;
}

let session: Session | null = null;
let snapshot: CallSessionSnapshot = IDLE;
const listeners = new Set<() => void>();
let storeUnsubscribe: (() => void) | null = null;

const emit = (patch: Partial<CallSessionSnapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => snapshot;

export const useCallSession = (): CallSessionSnapshot =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

const sessionKey = (livekitUrl: string, token: string) => `${livekitUrl}|${token}`;

// A device (camera/mic) permission/availability problem during enable,
// distinct from a connect failure. Mirrors the web SDK's humanizeDeviceError.
const humanizeDeviceError = (error: unknown): string => {
  const name = (error as { name?: string })?.name || '';
  const text = String((error as Error)?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || text.includes('permission') || text.includes('denied')) {
    return translateCallString('call.error.deviceBlocked');
  }
  if (name === 'NotFoundError' || text.includes('not found')) {
    return translateCallString('call.error.deviceNotFound');
  }
  if (name === 'NotReadableError' || text.includes('in use')) {
    return translateCallString('call.error.deviceInUse');
  }
  return translateCallString('call.error.deviceGeneric');
};

// Only a live, unmuted track gets a video surface, so the stage never
// flips between an avatar and a black frame (web's hasLiveVideo).
const liveVideoRef = (participant: any, Track: any) => {
  if (!participant) {return null;}
  const publication = participant.getTrackPublication?.(Track.Source.Camera);
  if (!publication?.track || publication.isMuted) {return null;}
  return { participant, publication, source: Track.Source.Camera };
};

const joinedAtMs = (participant: any): number => {
  const value = participant?.joinedAt;
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
};

const resync = () => {
  const current = session;
  const runtime = loadLiveKit();
  if (!current || current.disposed || !runtime) {return;}
  const { Track } = runtime;
  const room = current.room;

  const remote = Array.from(room.remoteParticipants?.values?.() || [])[0] as any;
  if (remote) {current.everJoined = true;}

  const remoteMic = remote?.getTrackPublication?.(Track.Source.Microphone);
  const localJoined = joinedAtMs(room.localParticipant);
  const remoteJoinedAt = joinedAtMs(remote);

  emit({
    remoteJoined: !!remote,
    remoteName: remote?.name || remote?.identity || null,
    remoteVideo: liveVideoRef(remote, Track),
    localVideo: liveVideoRef(room.localParticipant, Track),
    remoteMicMuted: !!remote && (!remoteMic || remoteMic.isMuted !== false),
    anchorAt:
      remote && localJoined && remoteJoinedAt
        ? Math.max(localJoined, remoteJoinedAt)
        : remote
          ? snapshot.anchorAt ?? Date.now()
          : null,
  });
};

export const stopCallSession = (): void => {
  const current = session;
  if (!current) {return;}
  current.disposed = true;
  session = null;
  try {
    current.room.removeAllListeners?.();
    void current.room.disconnect();
  } catch {
    // Already gone.
  }
  try {
    void loadLiveKit()?.AudioSession?.stopAudioSession();
  } catch {
    // Never let teardown throw.
  }
  snapshot = IDLE;
  listeners.forEach((listener) => listener());
};

// Tear the session down as soon as the call slice says there is no call to
// carry it any more, independent of what UI happens to be mounted.
const ensureStoreWatcher = () => {
  if (storeUnsubscribe) {return;}
  storeUnsubscribe = store.subscribe(() => {
    if (!session) {return;}
    const call = store.getState().call;
    const live =
      !!call.token && (call.phase === 'connecting' || call.phase === 'in-call');
    if (!live || !session.key.endsWith(`|${call.token}`)) {
      stopCallSession();
    }
  });
};

export interface StartCallSessionOptions {
  token: string;
  livekitUrl: string;
  kind: 'audio' | 'video';
  startWithMicOn?: boolean;
  startWithCameraOn?: boolean;
}

/**
 * Join the LiveKit room for the current call. Idempotent per (url, token):
 * calling it again from a remounted overlay re-attaches to the same room.
 */
export const startCallSession = ({
  token,
  livekitUrl,
  kind,
  startWithMicOn = true,
  startWithCameraOn = true,
}: StartCallSessionOptions): void => {
  const key = sessionKey(livekitUrl, token);
  if (session?.key === key) {return;}
  stopCallSession();
  ensureStoreWatcher();

  const runtime = loadLiveKit();
  if (!runtime) {
    store.dispatch(setCallError(translateCallString('call.error.sdkMissing')));
    return;
  }
  if (!token || !livekitUrl) {
    store.dispatch(setCallError(translateCallString('call.error.missingConfig')));
    return;
  }

  ensureLiveKitGlobals(runtime);
  const { Room, RoomEvent, AudioSession, VideoPresets } = runtime;

  // The web session's options, verbatim. `pixelDensity: 'screen'` matters:
  // with a plain `adaptiveStream: true` the subscriber asks for a layer
  // sized to the view in POINTS, i.e. 2-3x below the phone's real pixels,
  // and the peer's video arrived visibly blurry next to web.
  const room = new Room({
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: true,
    ...(VideoPresets
      ? {
          publishDefaults: {
            videoSimulcastLayers: [VideoPresets.h540, VideoPresets.h216],
          },
          videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        }
      : {}),
  });
  const current: Session = { key, room, kind, disposed: false, everJoined: false };
  session = current;
  snapshot = {
    ...IDLE,
    active: true,
    micOn: startWithMicOn,
    cameraOn: kind === 'video' && startWithCameraOn,
    // Video calls belong on the loudspeaker, audio calls on the earpiece.
    speakerOn: kind === 'video',
  };
  listeners.forEach((listener) => listener());

  const onChange = () => {
    if (!current.disposed) {resync();}
  };

  room
    .on(RoomEvent.TrackSubscribed, onChange)
    .on(RoomEvent.TrackUnsubscribed, onChange)
    .on(RoomEvent.TrackPublished, onChange)
    .on(RoomEvent.TrackUnpublished, onChange)
    .on(RoomEvent.LocalTrackPublished, onChange)
    .on(RoomEvent.LocalTrackUnpublished, onChange)
    .on(RoomEvent.TrackMuted, onChange)
    .on(RoomEvent.TrackUnmuted, onChange)
    .on(RoomEvent.ParticipantConnected, onChange)
    .on(RoomEvent.MediaDevicesError, (error: unknown) => {
      if (current.disposed) {return;}
      emit({ deviceError: humanizeDeviceError(error) });
    })
    .on(RoomEvent.ParticipantDisconnected, () => {
      if (current.disposed) {return;}
      resync();
      // 1:1 semantics, as web's PeerLeaveWatcher: once the peer had been
      // in the room, their leaving IS the end of the call. Before they
      // join (outgoing "Ringing...") an empty room is expected.
      if (current.everJoined && (room.remoteParticipants?.size ?? 0) === 0) {
        terminateActiveCall('ended');
      }
    })
    .on(RoomEvent.Disconnected, () => {
      if (current.disposed) {return;}
      emit({ connected: false });
      terminateActiveCall('ended');
    });

  (async () => {
    // Joining the LiveKit room is the only step whose failure should fail
    // the call (bad token, network, server down). Device setup below is
    // best-effort.
    try {
      // Claims audio focus and sets the right native audio mode. Must
      // start BEFORE connecting or the first seconds route to the earpiece
      // on Android even for a video call.
      try {
        await AudioSession.startAudioSession();
      } catch {
        // A call answered from the CallKit banner: CallKit owns the iOS
        // audio session and activates it itself (useCallKeep forwards that
        // to WebRTC), so our own activation is refused. Not a reason to
        // fail the call.
      }
      await room.connect(livekitUrl, token);
    } catch (error: any) {
      if (current.disposed) {return;}
      stopCallSession();
      store.dispatch(
        setCallError(
          String(error?.message || '') ||
            translateCallString('call.error.connectFailed')
        )
      );
      return;
    }
    if (current.disposed) {return;}

    // Devices are best-effort: a blocked permission or the iOS Simulator
    // (no camera at all) must not kill a call that connected fine.
    try {
      await room.localParticipant.setMicrophoneEnabled(startWithMicOn);
    } catch (error) {
      if (!current.disposed) {emit({ deviceError: humanizeDeviceError(error) });}
    }
    if (kind === 'video') {
      try {
        await room.localParticipant.setCameraEnabled(startWithCameraOn);
      } catch (error) {
        if (!current.disposed) {
          emit({ cameraOn: false, deviceError: humanizeDeviceError(error) });
        }
      }
    }
    if (current.disposed) {return;}

    try {
      await AudioSession.setAppleAudioConfiguration?.({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: kind === 'video' ? ['defaultToSpeaker'] : [],
        audioMode: kind === 'video' ? 'videoChat' : 'voiceChat',
      });
    } catch {
      // iOS-only helper.
    }

    emit({ connected: true });
    resync();
    store.dispatch(setCallPhase('in-call'));
  })();
};

// ---- controls -----------------------------------------------------------

export const toggleCallMic = (): Promise<void> => setCallMicEnabled(!snapshot.micOn);

/** Set the mic to a given state (system call UI reports absolute values). */
export const setCallMicEnabled = async (next: boolean): Promise<void> => {
  const current = session;
  if (!current || snapshot.micOn === next) {return;}
  emit({ micOn: next });
  try {
    await current.room.localParticipant.setMicrophoneEnabled(next);
  } catch (error) {
    if (!current.disposed) {
      emit({ micOn: !next, deviceError: humanizeDeviceError(error) });
    }
  }
};

export const toggleCallCamera = async (): Promise<void> => {
  const current = session;
  if (!current) {return;}
  const next = !snapshot.cameraOn;
  emit({ cameraOn: next });
  try {
    await current.room.localParticipant.setCameraEnabled(next);
    resync();
  } catch (error) {
    if (!current.disposed) {
      emit({ cameraOn: !next, deviceError: humanizeDeviceError(error) });
    }
  }
};

let switchingCamera = false;

export const switchCallCamera = async (): Promise<void> => {
  const current = session;
  const runtime = loadLiveKit();
  if (!current || !runtime || switchingCamera) {return;}
  const track = current.room.localParticipant.getTrackPublication?.(
    runtime.Track.Source.Camera
  )?.track;
  if (!track?.restartTrack) {return;}
  const next = snapshot.facingMode === 'user' ? 'environment' : 'user';
  switchingCamera = true;
  try {
    // A real device change needs a new capture: react-native-webrtc's
    // native applyConstraints only applies width/height/frameRate and
    // ignores facingMode on both platforms, so the old approach kept the
    // front camera and merely flipped our mirror flag (the picture looked
    // swapped left to right). restartTrack re-acquires the camera with
    // the new facing mode and swaps it into the published sender; the
    // <VideoTrack /> view follows it through TrackEvent.Restarted.
    await track.restartTrack({
      facingMode: next,
      ...(runtime.VideoPresets
        ? { resolution: runtime.VideoPresets.h720.resolution }
        : {}),
    });
    if (current.disposed) {return;}
    // Trust what the camera reports: a device with a single camera stays
    // on it, and the mirror must follow the real camera, not the request.
    const actual = track.mediaStreamTrack?.getSettings?.()?.facingMode;
    emit({
      facingMode: actual === 'user' || actual === 'environment' ? actual : next,
      localVideoEpoch: snapshot.localVideoEpoch + 1,
    });
    resync();
  } catch (error) {
    if (!current.disposed) {emit({ deviceError: humanizeDeviceError(error) });}
  } finally {
    switchingCamera = false;
  }
};

export const toggleCallSpeaker = async (): Promise<void> => {
  const runtime = loadLiveKit();
  if (!session || !runtime) {return;}
  const next = !snapshot.speakerOn;
  emit({ speakerOn: next });
  try {
    if (Platform.OS === 'android') {
      // On Android `selectAudioOutput` device ids are the literal strings
      // 'speaker' / 'earpiece'.
      await runtime.AudioSession.selectAudioOutput(next ? 'speaker' : 'earpiece');
    } else {
      await runtime.AudioSession.setAppleAudioConfiguration?.({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: next ? ['defaultToSpeaker'] : [],
        audioMode: next ? 'videoChat' : 'voiceChat',
      });
    }
  } catch {
    emit({ speakerOn: !next });
  }
};

export const dismissCallDeviceError = (): void => {
  emit({ deviceError: null });
};

/** Reset module state. Test seam only. */
export const __resetCallSessionForTests = (): void => {
  stopCallSession();
  storeUnsubscribe?.();
  storeUnsubscribe = null;
};
