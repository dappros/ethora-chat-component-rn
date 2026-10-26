import React, { FC, useState } from 'react';
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
  FillVideoIcon,
  FitVideoIcon,
  MicOffIcon,
  MinimizeIcon,
} from './CallIcons';
import { loadLiveKit } from './livekitRuntime';
import { loadWebRTC } from '../../calls/p2p/webrtcRuntime';
import { dismissCallDeviceError, useCallSession } from './callSessionController';
import { CallVideo } from './CallVideo';
import { CallControlBar } from './CallControlBar';
import { GroupCallView } from './GroupCallView';
import { formatCallDuration, useSharedCallElapsed } from './callElapsed';
import { usePipTile } from './usePipTile';
import { useT } from '../../i18n/useT';

const DEFAULT_PRIMARY = '#0052CD';
const SURFACE_DARK = '#0B1220';
const TEXT_ON_DARK = '#FFFFFF';
const TEXT_MUTED = '#9AA4B2';
const CONTROL_IDLE = 'rgba(255, 255, 255, 0.16)';

// Re-exported for the header strip, which shares the timer with this screen.
export { formatCallDuration, useSharedCallElapsed };

export interface VideoCallSessionProps {
  kind?: 'audio' | 'video';
  /** Group room call: everyone in a grid, instead of the 1:1 stage. */
  isGroup?: boolean;
  /** Display name of the peer, shown until LiveKit reports theirs. */
  peerName?: string | null;
  primaryColor?: string;
  icons?: VideoCallIcons;
  /** Minimize to the header strip (ActiveCallBar). */
  onToggleMinimize?: () => void;
  onHangup: () => void;
}

/**
 * The call screen, React Native edition. Pure view over the media session
 * of the call (the LiveKit room in callSessionController.ts, or the peer to
 * peer connection in p2pCallSession.ts): it can unmount and remount
 * (minimize, leaving the chat screen) without touching the connection.
 *
 * The web SDK builds this on `@livekit/components-react` hooks, which
 * assume a DOM. Only the video surfaces come from the native packages
 * (`<CallVideo />`: LiveKit's `<VideoTrack />` or the fork's `<RTCView />`).
 */
export const VideoCallSession: FC<VideoCallSessionProps> = ({
  kind = 'video',
  isGroup = false,
  peerName,
  primaryColor = DEFAULT_PRIMARY,
  icons,
  onToggleMinimize,
  onHangup,
}) => {
  const t = useT();
  const insets = useSafeAreaInsets();
  // A p2p call needs the WebRTC package only, a LiveKit call the LiveKit one.
  const hasMedia = !!loadLiveKit() || !!loadWebRTC();
  const session = useCallSession();
  const pipTile = usePipTile({ topInset: insets.top });
  const elapsed = useSharedCallElapsed(session.anchorAt);
  // Telegram-style: tap the small tile to swap it with the big one.
  const [swapped, setSwapped] = useState(false);
  // The peer's video is shown whole by default: a web camera is landscape,
  // and filling a portrait phone crops most of it away. The button next to
  // minimize stretches it to fill (the old behaviour) and back.
  const [fillRemote, setFillRemote] = useState(false);

  if (!hasMedia) {
    return (
      <View style={[styles.canvas, styles.centered]}>
        <Text style={styles.errorText}>{t('call.error.sdkMissing')}</Text>
      </View>
    );
  }

  if (isGroup) {
    return (
      <GroupCallView
        session={session}
        kind={kind}
        title={peerName}
        primaryColor={primaryColor}
        icons={icons}
        onToggleMinimize={onToggleMinimize}
        onHangup={onHangup}
      />
    );
  }

  const {
    connected,
    remoteJoined,
    remoteVideo,
    localVideo,
    micOn,
    cameraOn,
    deviceError,
    remoteMicMuted,
    facingMode,
    localVideoEpoch,
    reconnecting,
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
  const mainIsRemote = !!mainVideo && mainVideo === remoteVideo;
  const mainFit = mainIsRemote && !fillRemote ? 'contain' : 'cover';
  // Only the front camera is mirrored, as in every camera app.
  const selfMirror = facingMode === 'user';
  // The local view remounts when the camera is re-acquired (switching
  // front/back), so it never keeps rendering the stopped stream.
  // A p2p stream handle also carries its track ids (`key`), so a track that
  // arrives or is replaced remounts the view.
  const videoKey = (ref: any) =>
    `${ref === localVideo ? `local-${localVideoEpoch}` : 'remote'}${
      ref?.key ? `:${ref.key}` : ''
    }`;

  const statusText = reconnecting
    ? t('call.status.reconnecting')
    : elapsed !== null
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
      <View style={styles.stage} onLayout={pipTile.onStageLayout}>
        {mainVideo ? (
          <CallVideo
            key={videoKey(mainVideo)}
            source={mainVideo}
            style={styles.remoteVideo}
            objectFit={mainFit}
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

        {/* Picture-in-picture: drag it and it snaps to a corner, pinch it
            for the large size, tap it to swap it with the main video. */}
        {pipVideo && (
          <Animated.View
            {...pipTile.panHandlers}
            style={[styles.pip, pipTile.style]}
          >
            <Pressable
              style={styles.pipVideo}
              disabled={!canSwap}
              onPress={() => setSwapped((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={t('call.action.swapVideo')}
            >
              <CallVideo
                key={videoKey(pipVideo)}
                source={pipVideo}
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

        {mainIsRemote && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              fillRemote ? t('call.action.fitVideo') : t('call.action.fillVideo')
            }
            onPress={() => setFillRemote((value) => !value)}
            style={[styles.minimizeButton, styles.fitButton, { top: 16 + insets.top }]}
          >
            {fillRemote ? (
              <FitVideoIcon color={TEXT_ON_DARK} size={20} />
            ) : (
              <FillVideoIcon color={TEXT_ON_DARK} size={20} />
            )}
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
      <CallControlBar
        session={session}
        isVideo={isVideo}
        icons={icons}
        onHangup={onHangup}
      />
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
    paddingHorizontal: 108,
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
  // Next to minimize, top-left: the top-right corner belongs to the tile.
  fitButton: {
    left: 60,
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
