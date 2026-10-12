import React, { FC, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoCallIcons } from '../../types/types';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import {
  CameraOffIcon,
  CameraOnIcon,
  HangUpIcon,
  MicOffIcon,
  MicOnIcon,
  MinimizeIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SwitchCameraIcon,
} from './CallIcons';
import { loadLiveKit } from './livekitRuntime';
import {
  dismissCallDeviceError,
  switchCallCamera,
  toggleCallCamera,
  toggleCallMic,
  toggleCallSpeaker,
  useCallSession,
} from './callSessionController';
import { useDraggable } from './useDraggable';
import { useT } from '../../i18n/useT';

const DEFAULT_PRIMARY = '#0052CD';
const SURFACE_DARK = '#0B1220';
const TEXT_ON_DARK = '#FFFFFF';
const TEXT_MUTED = '#9AA4B2';
const DANGER = '#E53935';
const CONTROL_IDLE = 'rgba(255, 255, 255, 0.16)';

export interface VideoCallSessionProps {
  kind?: 'audio' | 'video';
  /** Display name of the peer, shown until LiveKit reports theirs. */
  peerName?: string | null;
  primaryColor?: string;
  icons?: VideoCallIcons;
  /** Minimize to the header strip (ActiveCallBar). */
  onToggleMinimize?: () => void;
  onHangup: () => void;
}

/**
 * Seconds since the call truly connected, counted from the server-set
 * `joinedAt` anchor so both sides show the same time (web's
 * useSharedCallElapsed). Null until the peer is in.
 */
export const useSharedCallElapsed = (anchorAt: number | null): number | null => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (anchorAt === null) {return;}
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anchorAt]);
  if (anchorAt === null) {return null;}
  return Math.max(0, Math.floor((Date.now() - anchorAt) / 1000));
};

export const formatCallDuration = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * The call screen, React Native edition. Pure view over the LiveKit session
 * owned by callSessionController.ts: it can unmount and remount (minimize,
 * leaving the chat screen) without touching the connection.
 *
 * The web SDK builds this on `@livekit/components-react` hooks, which
 * assume a DOM. Only the video surface comes from `@livekit/react-native`
 * (`<VideoTrack />`, `trackRef` prop, >= 2.7).
 */
export const VideoCallSession: FC<VideoCallSessionProps> = ({
  kind = 'video',
  peerName,
  primaryColor = DEFAULT_PRIMARY,
  icons,
  onToggleMinimize,
  onHangup,
}) => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const runtime = loadLiveKit();
  const session = useCallSession();
  const selfView = useDraggable();
  const elapsed = useSharedCallElapsed(session.anchorAt);
  // Telegram-style: tap the small tile to swap it with the big one.
  const [swapped, setSwapped] = useState(false);

  if (!runtime) {
    return (
      <View style={[styles.canvas, styles.centered]}>
        <Text style={styles.errorText}>{t('call.error.sdkMissing')}</Text>
      </View>
    );
  }

  const { VideoTrack } = runtime;
  const {
    connected,
    remoteJoined,
    remoteVideo,
    localVideo,
    micOn,
    cameraOn,
    speakerOn,
    deviceError,
    remoteMicMuted,
    facingMode,
  } = session;
  // The call slice's name (the chat title) first, as web does: LiveKit's
  // participant name is often just the opaque xmpp identity.
  const displayName = peerName || session.remoteName || t('call.unknownCaller');
  const isVideo = kind === 'video';
  const showRemoteVideo = isVideo && !!remoteVideo;
  const localLive = isVideo && cameraOn && !!localVideo;
  // Swapping only means something while both sides have a picture; if
  // either goes away, fall back to the default layout on its own.
  const canSwap = showRemoteVideo && localLive;
  const isSwapped = swapped && canSwap;
  const mainVideo = isSwapped ? localVideo : showRemoteVideo ? remoteVideo : null;
  const pipVideo = isSwapped ? remoteVideo : localLive ? localVideo : null;
  // Only the front camera is mirrored, as in every camera app.
  const selfMirror = facingMode === 'user';

  const statusText =
    elapsed !== null
      ? formatCallDuration(elapsed)
      : !connected
        ? t('call.status.connecting')
        : !remoteJoined
          ? t('call.status.waitingForPeer')
          : t('call.status.inCall');

  const peerMutedLabel = t('call.peerMuted', { name: displayName });

  return (
    <View style={styles.canvas}>
      {/* Stage */}
      <View style={styles.stage}>
        {mainVideo ? (
          <VideoTrack
            trackRef={mainVideo}
            style={styles.remoteVideo}
            objectFit="cover"
            mirror={isSwapped && selfMirror}
            zOrder={0}
          />
        ) : (
          <View style={styles.centered}>
            <ProfileImagePlaceholder name={displayName} size={120} />
            <Text style={styles.stageName}>{displayName}</Text>
            <Text style={styles.stageStatus}>
              {isVideo && remoteJoined && elapsed !== null
                ? t('call.status.cameraOff')
                : statusText}
            </Text>
            {!connected && (
              <ActivityIndicator color={primaryColor} style={styles.spinner} size="small" />
            )}
            {!micOn && (
              <View style={[styles.pill, styles.pillDanger]}>
                <Text style={styles.pillDangerText}>{t('call.selfMuted')}</Text>
              </View>
            )}
            {remoteMicMuted && !showRemoteVideo && (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{peerMutedLabel}</Text>
              </View>
            )}
          </View>
        )}

        {/* Header strip: who, how long, and whether they can hear us. */}
        {mainVideo && (
          <View style={[styles.header, { paddingTop: 14 + insets.top }]}>
            <Text style={styles.headerName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.headerStatus}>{statusText}</Text>
            {remoteMicMuted && (
              <View style={[styles.pill, styles.headerPill]}>
                <MicOffIcon color={TEXT_ON_DARK} size={14} />
                <Text style={styles.pillText}>{peerMutedLabel}</Text>
              </View>
            )}
          </View>
        )}

        {/* Picture-in-picture: draggable like web's self-view, tap to swap
            it with the main video. */}
        {pipVideo && (
          <Animated.View
            {...selfView.panHandlers}
            style={[styles.pip, { top: 16 + insets.top }, selfView.style]}
          >
            <Pressable
              style={styles.pipVideo}
              disabled={!canSwap}
              onPress={() => setSwapped((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={t('call.action.swapVideo')}
            >
              <VideoTrack
                trackRef={pipVideo}
                style={styles.pipVideo}
                objectFit="cover"
                mirror={!isSwapped && selfMirror}
                zOrder={1}
              />
            </Pressable>
          </Animated.View>
        )}

        {onToggleMinimize && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('call.action.minimize')}
            onPress={onToggleMinimize}
            style={[styles.minimizeButton, { top: 16 + insets.top }]}
          >
            <MinimizeIcon color={TEXT_ON_DARK} size={20} />
          </TouchableOpacity>
        )}

        {!!deviceError && (
          <TouchableOpacity
            style={[styles.deviceErrorBanner, { top: 64 + insets.top }]}
            onPress={dismissCallDeviceError}
            accessibilityRole="button"
          >
            <Text style={styles.deviceErrorText} numberOfLines={2}>
              {deviceError}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Control bar */}
      <View style={[styles.controls, { paddingBottom: 20 + insets.bottom }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={micOn ? t('call.action.muteMic') : t('call.action.unmuteMic')}
          onPress={toggleCallMic}
          style={[styles.controlButton, { backgroundColor: micOn ? CONTROL_IDLE : DANGER }]}
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
            onPress={toggleCallCamera}
            style={[styles.controlButton, { backgroundColor: cameraOn ? CONTROL_IDLE : DANGER }]}
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
            onPress={switchCallCamera}
            style={[styles.controlButton, { backgroundColor: CONTROL_IDLE }]}
          >
            <SwitchCameraIcon color={TEXT_ON_DARK} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={speakerOn ? t('call.action.speakerOff') : t('call.action.speakerOn')}
          onPress={toggleCallSpeaker}
          style={[styles.controlButton, { backgroundColor: CONTROL_IDLE }]}
        >
          {speakerOn ? <SpeakerIcon color={TEXT_ON_DARK} /> : <SpeakerOffIcon color={TEXT_ON_DARK} />}
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
    paddingHorizontal: 24,
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
    textAlign: 'center',
  },
  stageStatus: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  spinner: {
    marginTop: 8,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 64,
    paddingBottom: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: 2,
  },
  headerName: {
    color: TEXT_ON_DARK,
    fontSize: 15,
    fontWeight: '600',
  },
  headerStatus: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  headerPill: {
    marginTop: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: CONTROL_IDLE,
  },
  pillText: {
    color: TEXT_ON_DARK,
    fontSize: 12,
  },
  pillDanger: {
    backgroundColor: 'rgba(229, 57, 53, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(229, 57, 53, 0.45)',
  },
  pillDangerText: {
    color: '#FF8A80',
    fontSize: 12,
  },
  pip: {
    position: 'absolute',
    right: 16,
    width: 104,
    height: 148,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 5,
  },
  pipVideo: {
    flex: 1,
  },
  minimizeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 6,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 20,
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
  // Dismissible, non-blocking: the call is still up underneath; this only
  // flags that camera/mic didn't come up.
  deviceErrorBanner: {
    position: 'absolute',
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
});

export default VideoCallSession;
