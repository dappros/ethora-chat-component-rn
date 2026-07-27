import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { VideoCallIcons } from '../../types/types';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import {
  CameraOffIcon,
  CameraOnIcon,
  HangUpIcon,
  MicOffIcon,
  MicOnIcon,
  MinimizeIcon,
  ExpandIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SwitchCameraIcon,
} from './CallIcons';
import { ensureLiveKitGlobals, loadLiveKit } from './livekitRuntime';
import { useT } from '../../i18n/useT';

const DEFAULT_PRIMARY = '#0052CD';
const SURFACE_DARK = '#0B1220';
const TEXT_ON_DARK = '#FFFFFF';
const TEXT_MUTED = '#9AA4B2';
const DANGER = '#E53935';
const CONTROL_IDLE = 'rgba(255, 255, 255, 0.16)';

// A device (camera/mic) permission/availability problem during enable —
// distinct from a connect failure. Mirrors the web SDK's humanizeDeviceError:
// this must never fail the whole call (the user can still talk/hear once
// they re-allow or plug in a device), only surface a dismissible hint. Most
// relevant on the iOS Simulator, which has no real camera at all — every
// video call would otherwise die at setCameraEnabled before ever connecting.
const humanizeDeviceError = (error: unknown, t: (key: string) => string): string => {
  const name = (error as { name?: string })?.name || '';
  const text = String((error as Error)?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || text.includes('permission') || text.includes('denied')) {
    return t('call.error.deviceBlocked');
  }
  if (name === 'NotFoundError' || text.includes('not found')) {
    return t('call.error.deviceNotFound');
  }
  if (name === 'NotReadableError' || text.includes('in use')) {
    return t('call.error.deviceInUse');
  }
  return t('call.error.deviceGeneric');
};

export interface VideoCallSessionProps {
  token: string;
  livekitUrl: string;
  kind?: 'audio' | 'video';
  /** Display name of the peer, shown on the audio-call canvas. */
  peerName?: string | null;
  primaryColor?: string;
  icons?: VideoCallIcons;
  /** Start with the camera on (video calls). Default true. */
  startWithCameraOn?: boolean;
  /** Start with the microphone on. Default true. */
  startWithMicOn?: boolean;
  /** Render the compact floating-panel layout instead of the full screen. */
  minimized?: boolean;
  /** Toggle between full and minimized layouts (keeps the session mounted). */
  onToggleMinimize?: () => void;
  onConnected?: () => void;
  onError?: (message: string) => void;
  onHangup: () => void;
}

/**
 * The LiveKit session, React Native edition.
 *
 * The web SDK builds this on `@livekit/components-react` hooks. That package
 * assumes a DOM, so here we drive `livekit-client`'s imperative `Room` API
 * directly and keep the derived bits (subscribed tracks, mute flags,
 * connection state) in local React state, re-syncing on RoomEvent. Only the
 * actual video surface comes from `@livekit/react-native` (`<VideoTrack />`),
 * which wraps the native renderer.
 *
 * Requires `@livekit/react-native` >= 2.7 for the `trackRef` prop shape used
 * below. Both LiveKit packages are optional peer deps, see livekitRuntime.ts.
 */
export const VideoCallSession: FC<VideoCallSessionProps> = ({
  token,
  livekitUrl,
  kind = 'video',
  peerName,
  primaryColor = DEFAULT_PRIMARY,
  icons,
  startWithCameraOn = true,
  startWithMicOn = true,
  minimized = false,
  onToggleMinimize,
  onConnected,
  onError,
  onHangup,
}) => {
  const t = useT();
  const runtime = useMemo(() => loadLiveKit(), []);

  const roomRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(startWithMicOn);
  const [cameraOn, setCameraOn] = useState(kind === 'video' && startWithCameraOn);
  const [speakerOn, setSpeakerOn] = useState(kind === 'video');
  const [remoteVideo, setRemoteVideo] = useState<any>(null);
  const [localVideo, setLocalVideo] = useState<any>(null);
  const [remoteName, setRemoteName] = useState<string | null>(null);
  const [remoteJoined, setRemoteJoined] = useState(false);

  // Callbacks are read through a ref inside the connect effect so that a
  // parent re-render (new inline arrow props) never re-runs connect and
  // tears down a live call. Same guard the web session uses.
  const callbacksRef = useRef({ onConnected, onError, onHangup });
  useEffect(() => {
    callbacksRef.current = { onConnected, onError, onHangup };
  }, [onConnected, onError, onHangup]);

  // ---- track plumbing -------------------------------------------------

  // Build the { participant, publication, source } shape `<VideoTrack />`
  // expects, from whatever camera publication a participant currently has.
  const toTrackRef = useCallback(
    (participant: any, Track: any) => {
      if (!participant) {return null;}
      const publication = participant.getTrackPublication?.(Track.Source.Camera);
      if (!publication?.track) {return null;}
      return { participant, publication, source: Track.Source.Camera };
    },
    []
  );

  const resyncTracks = useCallback(() => {
    const room = roomRef.current;
    if (!room || !runtime) {return;}
    const { Track } = runtime;

    const remote = Array.from(room.remoteParticipants?.values?.() || [])[0] as any;
    setRemoteJoined(!!remote);
    setRemoteName(remote?.name || remote?.identity || null);
    setRemoteVideo(toTrackRef(remote, Track));
    setLocalVideo(toTrackRef(room.localParticipant, Track));
  }, [runtime, toTrackRef]);

  // ---- connect / teardown ---------------------------------------------

  useEffect(() => {
    if (!runtime) {
      callbacksRef.current.onError?.(t('call.error.sdkMissing'));
      return;
    }
    if (!token || !livekitUrl) {
      callbacksRef.current.onError?.(t('call.error.missingConfig'));
      return;
    }

    ensureLiveKitGlobals(runtime);

    const { Room, RoomEvent, AudioSession } = runtime;
    let disposed = false;

    // adaptiveStream + dynacast keep mobile data and battery sane: the SDK
    // drops resolution for a small tile and stops publishing layers nobody
    // subscribes to. Both are safe defaults for 1:1.
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const onStateChange = () => {
      if (disposed) {return;}
      resyncTracks();
    };

    room
      .on(RoomEvent.TrackSubscribed, onStateChange)
      .on(RoomEvent.TrackUnsubscribed, onStateChange)
      .on(RoomEvent.LocalTrackPublished, onStateChange)
      .on(RoomEvent.LocalTrackUnpublished, onStateChange)
      .on(RoomEvent.TrackMuted, onStateChange)
      .on(RoomEvent.TrackUnmuted, onStateChange)
      .on(RoomEvent.ParticipantConnected, onStateChange)
      .on(RoomEvent.MediaDevicesError, (error: unknown) => {
        if (disposed) {return;}
        setDeviceError(humanizeDeviceError(error, t));
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        if (disposed) {return;}
        resyncTracks();
        // 1:1 semantics: the other side leaving IS the end of the call.
        // Without this the local user sits on a black canvas until they
        // hang up manually.
        callbacksRef.current.onHangup?.();
      })
      .on(RoomEvent.Disconnected, () => {
        if (disposed) {return;}
        setConnected(false);
        callbacksRef.current.onHangup?.();
      });

    (async () => {
      // Joining the LiveKit room is the only step whose failure should fail
      // the call (bad token, network, server down). Everything after this
      // is best-effort device setup — see the separate try/catches below.
      try {
        // Claims audio focus and sets the right native audio mode. Must
        // start BEFORE connecting or the first seconds route to the
        // earpiece on Android even for a video call.
        await AudioSession.startAudioSession();
        await room.connect(livekitUrl, token);
      } catch (error: any) {
        if (disposed) {return;}
        callbacksRef.current.onError?.(
          String(error?.message || '') || t('call.error.connectFailed')
        );
        return;
      }
      if (disposed) {return;}

      // Devices are best-effort: if the mic/camera prompt is blocked, or —
      // notably — this is the iOS Simulator (no real camera hardware at
      // all), the call still connects. The user can hear/be heard on
      // audio and re-enable the camera later; failing the whole call here
      // (as an earlier version did, sharing one try/catch with `connect`)
      // meant every video call died before ever reaching the ring-answered
      // screen — indistinguishable from "Accept doesn't work".
      try {
        await room.localParticipant.setMicrophoneEnabled(startWithMicOn);
      } catch (error) {
        if (!disposed) {setDeviceError(humanizeDeviceError(error, t));}
      }
      if (kind === 'video') {
        try {
          await room.localParticipant.setCameraEnabled(startWithCameraOn);
        } catch (error) {
          if (!disposed) {setDeviceError(humanizeDeviceError(error, t));}
        }
      }
      if (disposed) {return;}

      // Video calls belong on the loudspeaker, audio calls on the
      // earpiece, matching what every native dialer does.
      try {
        await AudioSession.setAppleAudioConfiguration?.({
          audioCategory: 'playAndRecord',
          audioMode: kind === 'video' ? 'videoChat' : 'voiceChat',
        });
      } catch {
        // iOS-only helper, absent on Android builds of the SDK.
      }

      setConnected(true);
      resyncTracks();
      callbacksRef.current.onConnected?.();
    })();

    return () => {
      disposed = true;
      try {
        room.removeAllListeners?.();
        void room.disconnect();
      } catch {
        // Already gone.
      }
      try {
        void AudioSession.stopAudioSession();
      } catch {
        // Never let teardown throw, it runs during unmount.
      }
      roomRef.current = null;
    };
    // Connect exactly once per (url, token, kind). Everything else is read
    // through refs, see callbacksRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, livekitUrl, token, kind]);

  // ---- controls --------------------------------------------------------

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {return;}
    const next = !micOn;
    setMicOn(next);
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
    } catch {
      setMicOn(!next);
    }
  }, [micOn]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {return;}
    const next = !cameraOn;
    setCameraOn(next);
    try {
      await room.localParticipant.setCameraEnabled(next);
      resyncTracks();
    } catch {
      setCameraOn(!next);
    }
  }, [cameraOn, resyncTracks]);

  const switchCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !runtime) {return;}
    try {
      const publication = room.localParticipant.getTrackPublication?.(
        runtime.Track.Source.Camera
      );
      const track = publication?.track;
      // `restartTrack` with the flipped facingMode is the portable way to
      // switch cameras; the RN SDK's `_switchCamera` helper is internal and
      // has moved between versions.
      await track?.restartTrack?.({
        facingMode: track?.mediaStreamTrack?.getSettings?.().facingMode ===
        'environment'
          ? 'user'
          : 'environment',
      });
      resyncTracks();
    } catch {
      // Device has a single camera, or the track is mid-restart.
    }
  }, [runtime, resyncTracks]);

  const toggleSpeaker = useCallback(async () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (!runtime) {return;}
    try {
      if (Platform.OS === 'android') {
        await runtime.AudioSession.setAndroidAudioConfiguration?.({
          preferredOutputList: next ? ['speaker'] : ['earpiece'],
        });
      } else {
        await runtime.AudioSession.setAppleAudioConfiguration?.({
          audioCategory: 'playAndRecord',
          audioCategoryOptions: next ? ['defaultToSpeaker'] : [],
          audioMode: next ? 'videoChat' : 'voiceChat',
        });
      }
    } catch {
      setSpeakerOn(!next);
    }
  }, [runtime, speakerOn]);

  // ---- render ----------------------------------------------------------

  if (!runtime) {
    return (
      <View style={[styles.canvas, styles.centered]}>
        <Text style={styles.errorText}>{t('call.error.sdkMissing')}</Text>
      </View>
    );
  }

  const { VideoTrack } = runtime;
  const displayName = remoteName || peerName || t('call.unknownCaller');
  const isVideo = kind === 'video';
  const showRemoteVideo = isVideo && !!remoteVideo;

  if (minimized) {
    return (
      <View style={styles.miniBar}>
        <View style={styles.miniInfo}>
          <Text numberOfLines={1} style={styles.miniName}>
            {displayName}
          </Text>
          <Text style={styles.miniStatus}>
            {connected
              ? remoteJoined
                ? t('call.status.inCall')
                : t('call.status.waitingForPeer')
              : t('call.status.connecting')}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('call.action.expand')}
          onPress={onToggleMinimize}
          style={[styles.miniButton, { backgroundColor: CONTROL_IDLE }]}
        >
          <ExpandIcon color={TEXT_ON_DARK} size={20} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('call.action.hangUp')}
          onPress={onHangup}
          style={[styles.miniButton, { backgroundColor: DANGER }]}
        >
          {icons?.hangup ?? <HangUpIcon color={TEXT_ON_DARK} size={20} />}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.canvas}>
      {!!deviceError && (
        <TouchableOpacity
          style={styles.deviceErrorBanner}
          onPress={() => setDeviceError(null)}
          accessibilityRole="button"
        >
          <Text style={styles.deviceErrorText} numberOfLines={2}>
            {deviceError}
          </Text>
        </TouchableOpacity>
      )}
      {/* Stage */}
      <View style={styles.stage}>
        {showRemoteVideo ? (
          <VideoTrack trackRef={remoteVideo} style={styles.remoteVideo} objectFit="cover" />
        ) : (
          <View style={styles.centered}>
            <ProfileImagePlaceholder name={displayName} size={120} />
            <Text style={styles.stageName}>{displayName}</Text>
            <Text style={styles.stageStatus}>
              {!connected
                ? t('call.status.connecting')
                : !remoteJoined
                  ? t('call.status.waitingForPeer')
                  : isVideo
                    ? t('call.status.cameraOff')
                    : t('call.status.inCall')}
            </Text>
            {!connected && (
              <ActivityIndicator
                color={primaryColor}
                style={styles.spinner}
                size="small"
              />
            )}
          </View>
        )}

        {/* Local preview, picture-in-picture */}
        {isVideo && cameraOn && localVideo && (
          <View style={styles.pip}>
            <VideoTrack trackRef={localVideo} style={styles.pipVideo} objectFit="cover" mirror />
          </View>
        )}

        {onToggleMinimize && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('call.action.minimize')}
            onPress={onToggleMinimize}
            style={styles.minimizeButton}
          >
            <MinimizeIcon color={TEXT_ON_DARK} size={20} />
          </TouchableOpacity>
        )}
      </View>

      {/* Control bar */}
      <View style={styles.controls}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={micOn ? t('call.action.muteMic') : t('call.action.unmuteMic')}
          onPress={toggleMic}
          style={[
            styles.controlButton,
            { backgroundColor: micOn ? CONTROL_IDLE : DANGER },
          ]}
        >
          {micOn
            ? (icons?.micOn ?? <MicOnIcon color={TEXT_ON_DARK} />)
            : (icons?.micOff ?? <MicOffIcon color={TEXT_ON_DARK} />)}
        </TouchableOpacity>

        {isVideo && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              cameraOn ? t('call.action.stopCamera') : t('call.action.startCamera')
            }
            onPress={toggleCamera}
            style={[
              styles.controlButton,
              { backgroundColor: cameraOn ? CONTROL_IDLE : DANGER },
            ]}
          >
            {cameraOn
              ? (icons?.cameraOn ?? <CameraOnIcon color={TEXT_ON_DARK} />)
              : (icons?.cameraOff ?? <CameraOffIcon color={TEXT_ON_DARK} />)}
          </TouchableOpacity>
        )}

        {isVideo && cameraOn && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('call.action.switchCamera')}
            onPress={switchCamera}
            style={[styles.controlButton, { backgroundColor: CONTROL_IDLE }]}
          >
            <SwitchCameraIcon color={TEXT_ON_DARK} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={
            speakerOn ? t('call.action.speakerOff') : t('call.action.speakerOn')
          }
          onPress={toggleSpeaker}
          style={[styles.controlButton, { backgroundColor: CONTROL_IDLE }]}
        >
          {speakerOn ? (
            <SpeakerIcon color={TEXT_ON_DARK} />
          ) : (
            <SpeakerOffIcon color={TEXT_ON_DARK} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('call.action.hangUp')}
          onPress={onHangup}
          style={[styles.controlButton, styles.hangupButton]}
        >
          {icons?.hangup ?? <HangUpIcon color={TEXT_ON_DARK} />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: SURFACE_DARK,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stage: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  remoteVideo: {
    flex: 1,
    backgroundColor: '#000',
  },
  stageName: {
    color: TEXT_ON_DARK,
    fontSize: 22,
    marginTop: 16,
  },
  stageStatus: {
    color: TEXT_MUTED,
    fontSize: 14,
  },
  spinner: {
    marginTop: 8,
  },
  pip: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 104,
    height: 148,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pipVideo: {
    flex: 1,
  },
  minimizeButton: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangupButton: {
    backgroundColor: DANGER,
  },
  errorText: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  // Dismissible, non-blocking — the call is still connecting/connected
  // underneath; this only flags that camera/mic didn't come up.
  deviceErrorBanner: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(229, 57, 53, 0.92)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  deviceErrorText: {
    color: TEXT_ON_DARK,
    fontSize: 13,
    textAlign: 'center',
  },
  miniBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: SURFACE_DARK,
  },
  miniInfo: {
    flex: 1,
    minWidth: 0,
  },
  miniName: {
    color: TEXT_ON_DARK,
    fontSize: 15,
  },
  miniStatus: {
    color: TEXT_MUTED,
    fontSize: 12,
  },
  miniButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default VideoCallSession;
