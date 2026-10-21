import React, { FC } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoCallIcons } from '../../types/types';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import { CallVideo } from './CallVideo';
import { CallControlBar } from './CallControlBar';
import { MicOffIcon, MinimizeIcon } from './CallIcons';
import { dismissCallDeviceError } from './callSessionController';
import type { CallParticipantView, CallSessionSnapshot } from './callSessionTypes';
import { gridColumns, pickVideoTiles, speakingNames } from './groupLayout';
import { formatCallDuration, useSharedCallElapsed } from './callElapsed';
import { useT } from '../../i18n/useT';

const SURFACE_DARK = '#0B1220';
const TILE_DARK = '#111827';
const TEXT_ON_DARK = '#FFFFFF';
const TEXT_MUTED = 'rgba(255, 255, 255, 0.7)';
const DANGER = '#E53935';
const GAP = 8;
const PAD = 12;

interface GroupCallViewProps {
  session: CallSessionSnapshot;
  kind: 'audio' | 'video';
  /** Room name; a neutral label is shown when it is empty. */
  title?: string | null;
  primaryColor: string;
  icons?: VideoCallIcons;
  onToggleMinimize?: () => void;
  onHangup: () => void;
}

interface TileProps {
  participant: CallParticipantView;
  width: number;
  height: number;
  showVideo: boolean;
  primaryColor: string;
  youLabel: string;
  fallbackName: string;
  micOffLabel: string;
}

const ParticipantTile: FC<TileProps> = ({
  participant,
  width,
  height,
  showVideo,
  primaryColor,
  youLabel,
  fallbackName,
  micOffLabel,
}) => {
  const name = participant.isLocal
    ? youLabel
    : participant.name || fallbackName;
  return (
    <View
      testID="group-call-tile"
      accessibilityLabel={name}
      style={[
        styles.tile,
        { width, height },
        participant.speaking
          ? [styles.tileSpeaking, { borderColor: primaryColor }]
          : styles.tileIdle,
      ]}
    >
      {showVideo && participant.video ? (
        <CallVideo
          source={participant.video}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          // Mirror our own camera like every call app.
          mirror={participant.isLocal}
          zOrder={0}
        />
      ) : (
        <ProfileImagePlaceholder
          name={name}
          size={Math.max(48, Math.min(96, Math.round(width * 0.4)))}
        />
      )}
      <View style={styles.nameTag}>
        {participant.micMuted && (
          <View
            accessibilityLabel={micOffLabel}
            style={styles.micOffBadge}
          >
            <MicOffIcon color={TEXT_ON_DARK} size={11} />
          </View>
        )}
        <Text style={styles.nameText} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
};

/**
 * The group call screen: everyone in the room as a grid of tiles, the person
 * who is speaking outlined, a mic-off badge on anyone muted. Cameras are drawn
 * for at most MAX_VIDEO_TILES people (speakers first). Nothing here assumes
 * two people; the 1:1 layout stays in VideoCallSession.
 */
export const GroupCallView: FC<GroupCallViewProps> = ({
  session,
  kind,
  title,
  primaryColor,
  icons,
  onToggleMinimize,
  onHangup,
}) => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const elapsed = useSharedCallElapsed(session.anchorAt);
  const { participants, deviceError, connected } = session;
  const isVideo = kind === 'video';

  const columns = gridColumns(participants.length, width > height);
  const tileWidth = Math.floor(
    (width - PAD * 2 - GAP * (columns - 1)) / columns
  );
  const tileHeight =
    columns === 1
      ? Math.round(tileWidth * 0.75)
      : Math.round(tileWidth * (isVideo ? 1.15 : 0.85));
  const videoIds = isVideo ? pickVideoTiles(participants) : new Set<string>();

  const speaking = speakingNames(participants, t('call.participant.you'));
  const countLabel = t('call.status.participants', { count: participants.length });
  const status =
    elapsed !== null
      ? `${countLabel} · ${formatCallDuration(elapsed)}`
      : !connected
        ? t('call.status.connecting')
        : t('call.status.waitingForOthers');
  const heading =
    title || (isVideo ? t('call.groupVideoCall') : t('call.groupAudioCall'));

  return (
    <View style={styles.canvas}>
      <View style={[styles.header, { paddingTop: 14 + insets.top }]}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {heading}
        </Text>
        <Text style={styles.headerStatus} numberOfLines={1}>
          {status}
        </Text>
        {speaking.length > 0 && (
          <Text style={styles.headerSpeaking} numberOfLines={1}>
            {t('call.status.speaking', { names: speaking.join(', ') })}
          </Text>
        )}
      </View>

      {onToggleMinimize && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('call.action.minimize')}
          onPress={onToggleMinimize}
          style={[styles.minimizeButton, { top: 12 + insets.top }]}
        >
          <MinimizeIcon color={TEXT_ON_DARK} size={20} />
        </TouchableOpacity>
      )}

      {!!deviceError && (
        <TouchableOpacity
          style={styles.deviceErrorBanner}
          onPress={dismissCallDeviceError}
          accessibilityRole="button"
        >
          <Text style={styles.deviceErrorText} numberOfLines={2}>
            {deviceError}
          </Text>
        </TouchableOpacity>
      )}

      <ScrollView
        testID="group-call-grid"
        style={styles.scroll}
        contentContainerStyle={styles.grid}
      >
        {participants.map((participant) => (
          <ParticipantTile
            key={participant.identity || (participant.isLocal ? 'local' : participant.name)}
            participant={participant}
            width={tileWidth}
            height={tileHeight}
            showVideo={videoIds.has(participant.identity)}
            primaryColor={primaryColor}
            youLabel={t('call.participant.you')}
            fallbackName={t('call.participant.default')}
            micOffLabel={t('call.participant.micOff')}
          />
        ))}
      </ScrollView>

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
  header: {
    paddingHorizontal: 64,
    paddingBottom: 10,
    alignItems: 'center',
    gap: 2,
  },
  headerTitle: {
    color: TEXT_ON_DARK,
    fontSize: 16,
    fontWeight: '600',
  },
  headerStatus: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  headerSpeaking: {
    color: TEXT_MUTED,
    fontSize: 12,
  },
  minimizeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    zIndex: 6,
  },
  scroll: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'flex-start',
    gap: GAP,
    paddingHorizontal: PAD,
    paddingBottom: PAD,
  },
  tile: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: TILE_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSpeaking: {
    borderWidth: 3,
  },
  tileIdle: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  nameTag: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '90%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  nameText: {
    color: TEXT_ON_DARK,
    fontSize: 13,
    flexShrink: 1,
  },
  micOffBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: DANGER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceErrorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
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

export default GroupCallView;
