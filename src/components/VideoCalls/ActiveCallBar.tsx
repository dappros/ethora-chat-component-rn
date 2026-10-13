import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootState } from '../../roomStore';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { ExpandIcon, HangUpIcon, MicOffIcon, MicOnIcon } from './CallIcons';
import { toggleCallMic, useCallSession } from './callSessionController';
import { terminateActiveCall } from './callActions';
import {
  registerCallBarHost,
  setCallBarAnchor,
  setCallMinimized,
  useCallUi,
} from './callUiStore';
import { formatCallDuration, useSharedCallElapsed } from './VideoCallSession';

const DANGER = '#E53935';

/**
 * The strip's geometry: a floating bubble under the header. Exported so the
 * collapse animation of the full-screen call lands exactly on it.
 */
export const CALL_BAR_HEIGHT = 52;
export const CALL_BAR_MARGIN_X = 8;
export const CALL_BAR_MARGIN_TOP = 6;
export const CALL_BAR_RADIUS = 18;
const ON_BAR = '#FFFFFF';
const CONTROL = 'rgba(255, 255, 255, 0.2)';

/** True while a call is up and minimized, i.e. the strip should show. */
const useShowCallBar = (): boolean => {
  const { minimized } = useCallUi();
  const active = useSelector(
    (state: RootState) =>
      !!state.call.token &&
      (state.call.phase === 'connecting' || state.call.phase === 'in-call')
  );
  const { config } = useChatSettingState();
  return minimized && active && config?.videoCalls?.enabled === true;
};

/**
 * The minimized call: a strip with who, how long, mic, expand and hang up.
 * Tapping anywhere on it (outside the buttons) brings the call back
 * full-screen, like Telegram's "return to call" bar.
 */
export const ActiveCallBar: FC = () => {
  const t = useT();
  const theme = useTheme();
  const { icons } = useChatSettingState().config?.videoCalls || {};
  const peerName = useSelector((state: RootState) => state.call.roomName);
  const session = useCallSession();
  const elapsed = useSharedCallElapsed(session.anchorAt);

  const name = peerName || session.remoteName || t('call.unknownCaller');
  const status =
    elapsed !== null
      ? formatCallDuration(elapsed)
      : !session.connected
        ? t('call.status.connecting')
        : !session.remoteJoined
          ? t('call.status.waitingForPeer')
          : t('call.status.inCall');
  const statusLine = session.remoteMicMuted
    ? `${status} · ${t('call.peerMuted', { name })}`
    : status;
  const expand = () => setCallMinimized(false);

  return (
    <Pressable
      onPress={expand}
      accessibilityRole="button"
      accessibilityLabel={t('call.action.expand')}
      style={[styles.bar, { backgroundColor: theme.success }]}
    >
      <View style={styles.info}>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text numberOfLines={1} style={styles.status}>
          {statusLine}
        </Text>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={session.micOn ? t('call.action.muteMic') : t('call.action.unmuteMic')}
        onPress={toggleCallMic}
        style={[styles.button, { backgroundColor: session.micOn ? CONTROL : DANGER }]}
        hitSlop={6}
      >
        {session.micOn
          ? (icons?.micOn ?? <MicOnIcon color={ON_BAR} size={18} />)
          : (icons?.micOff ?? <MicOffIcon color={ON_BAR} size={18} />)}
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('call.action.expand')}
        onPress={expand}
        style={[styles.button, { backgroundColor: CONTROL }]}
        hitSlop={6}
      >
        <ExpandIcon color={ON_BAR} size={18} />
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('call.action.hangUp')}
        onPress={() => terminateActiveCall('ended')}
        style={[styles.button, { backgroundColor: DANGER }]}
        hitSlop={6}
      >
        {icons?.hangup ?? <HangUpIcon color={ON_BAR} size={18} />}
      </TouchableOpacity>
    </Pressable>
  );
};

/**
 * Mounted under each SDK header (chat and room list). Registers the header
 * as a place for the strip and renders it while this header is the current
 * host and a call is minimized; renders nothing otherwise.
 */
export const HeaderCallBar: FC = () => {
  const [hostId, setHostId] = useState<number | null>(null);
  const { barHost } = useCallUi();
  const show = useShowCallBar();
  const anchorRef = useRef<View>(null);
  const isHost = hostId !== null && barHost === hostId;

  // Returns its own unregister, which is the effect's cleanup.
  useEffect(() => registerCallBarHost(setHostId), []);

  // Where the strip goes on screen, for the collapse animation to aim at.
  const measure = useCallback(() => {
    if (hostId === null) {return;}
    anchorRef.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) {setCallBarAnchor(hostId, y);}
    });
  }, [hostId]);

  useEffect(() => {
    if (isHost) {measure();}
  }, [isHost, measure]);

  return (
    <>
      {/* Zero-height marker at the top of the strip slot. */}
      <View ref={anchorRef} collapsable={false} onLayout={measure} style={styles.anchor} />
      {show && isHost ? <ActiveCallBar /> : null}
    </>
  );
};

/**
 * The overlay's fallback when no SDK header is on screen: the same strip,
 * docked to the top under the status bar.
 */
export const DockedCallBar: FC = () => {
  const insets = useSafeAreaInsets();
  const { barHost } = useCallUi();
  const show = useShowCallBar();
  if (!show || barHost !== null) {return null;}
  return (
    <View style={[styles.docked, { paddingTop: insets.top }]} pointerEvents="box-none">
      <ActiveCallBar />
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: CALL_BAR_HEIGHT,
    marginHorizontal: CALL_BAR_MARGIN_X,
    marginTop: CALL_BAR_MARGIN_TOP,
    marginBottom: 2,
    paddingLeft: 16,
    paddingRight: 9,
    borderRadius: CALL_BAR_RADIUS,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  anchor: {
    height: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: ON_BAR,
    fontSize: 15,
    fontWeight: '600',
  },
  status: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docked: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1001,
    elevation: 12,
  },
});
