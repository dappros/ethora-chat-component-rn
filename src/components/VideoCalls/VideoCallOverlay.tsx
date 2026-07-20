import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, store } from '../../roomStore';
import {
  acceptIncomingCall,
  declineIncomingCall,
  endCall,
  resetCall,
  setCallError,
  setCallPhase,
} from '../../roomStore/callSlice';
import { addRoomMessage } from '../../roomStore/roomsSlice';
import { buildLocalCallLogMessage } from '../../helpers/callLogMessage';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import {
  CallSignalState,
  sendCallStateSignal,
} from '../../networking/callTokenStanza';
import { VideoCallSession } from './VideoCallSession';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import {
  AudioCallIcon,
  HangUpIcon,
  VideoCallIcon,
} from './CallIcons';
import { VideoCallIcons } from '../../types/types';
import { useT } from '../../i18n/useT';
import { useCallKeep } from './useCallKeep';

const DEFAULT_PRIMARY = '#0052CD';
const TEXT_PRIMARY = '#141414';
const TEXT_MUTED = '#8c8c8c';
const DANGER = '#E53935';
const ACCEPT = '#10B981';

// Stop the dial UI sitting forever when the server never broadcasts a
// call-token (offline peer, backend error, etc). 30s matches the typical
// PSTN ring window.
const OUTGOING_CALL_TIMEOUT_MS = 30000;

// Ring pattern for an incoming call: wait, buzz, pause, buzz... Android
// loops this from index 0, iOS ignores the pattern and just vibrates.
const RING_VIBRATION_PATTERN = [0, 700, 900];

const hexToRgba = (hex: string, alpha: number): string => {
  let value = String(hex || DEFAULT_PRIMARY).trim();
  if (value.startsWith('#')) {value = value.slice(1);}
  if (value.length === 3) {
    value = value
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (value.length !== 6) {return `rgba(0, 82, 205, ${alpha})`;}
  const num = parseInt(value, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * The expanding rings behind the avatar on the ring screen. Web does this
 * with a CSS @keyframes; RN needs a real Animated loop. `useNativeDriver`
 * keeps it on the UI thread so the pulse doesn't stutter while the JS
 * thread is busy connecting to LiveKit.
 */
const PulseRing: FC<{ color: string; delay: number }> = ({ color, delay }) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRing,
        {
          borderColor: color,
          opacity: progress.interpolate({
            inputRange: [0, 0.7, 1],
            outputRange: [0.55, 0, 0],
          }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [0.92, 1.4, 0.92],
              }),
            },
          ],
        },
      ]}
    />
  );
};

interface RingingCardProps {
  title: string;
  subtitle: string;
  roomName: string | null;
  kind: 'audio' | 'video';
  variant: 'incoming' | 'outgoing' | 'error';
  primaryColor: string;
  errorMessage?: string | null;
  icons?: VideoCallIcons;
  onAccept?: () => void;
  onDecline?: () => void;
  onHangup?: () => void;
  onDismiss?: () => void;
}

const RingingCard: FC<RingingCardProps> = ({
  title,
  subtitle,
  roomName,
  kind,
  variant,
  primaryColor,
  errorMessage,
  icons,
  onAccept,
  onDecline,
  onHangup,
  onDismiss,
}) => {
  const t = useT();

  return (
    <View style={styles.ringingCard}>
      <Text style={styles.ringingTitle}>{title}</Text>

      <View style={styles.avatarWrap}>
        {variant !== 'error' && (
          <>
            <PulseRing color={hexToRgba(primaryColor, 0.45)} delay={0} />
            <PulseRing color={hexToRgba(primaryColor, 0.3)} delay={900} />
          </>
        )}
        <ProfileImagePlaceholder name={roomName || 'Call'} size={120} />
      </View>

      <View style={styles.ringingIdentity}>
        <Text style={styles.ringingName}>
          {roomName ||
            (variant === 'incoming' ? t('call.unknownCaller') : t('call.title'))}
        </Text>
        <View style={styles.ringingSubtitleRow}>
          {kind === 'audio' ? (
            <AudioCallIcon color={TEXT_MUTED} size={16} />
          ) : (
            <VideoCallIcon color={TEXT_MUTED} size={16} />
          )}
          <Text style={styles.ringingSubtitle}>{subtitle}</Text>
        </View>
      </View>

      {!!errorMessage && (
        <View style={styles.errorBox}>
          <Text style={styles.errorBoxText}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.ringingActions}>
        {variant === 'incoming' && (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('call.action.decline')}
              onPress={onDecline}
              style={[styles.circleAction, { backgroundColor: DANGER }]}
            >
              {icons?.decline ?? <HangUpIcon color="#FFFFFF" />}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('call.action.accept')}
              onPress={onAccept}
              style={[styles.circleAction, { backgroundColor: ACCEPT }]}
            >
              {icons?.accept ??
                (kind === 'audio' ? (
                  <AudioCallIcon color="#FFFFFF" />
                ) : (
                  <VideoCallIcon color="#FFFFFF" />
                ))}
            </TouchableOpacity>
          </>
        )}

        {variant === 'outgoing' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('call.action.cancel')}
            onPress={onHangup}
            style={[styles.circleAction, { backgroundColor: DANGER }]}
          >
            {icons?.hangup ?? <HangUpIcon color="#FFFFFF" />}
          </TouchableOpacity>
        )}

        {variant === 'error' && (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onDismiss}
            style={[styles.dismissButton, { backgroundColor: primaryColor }]}
          >
            <Text style={styles.dismissText}>{t('call.action.dismiss')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

/**
 * Call orchestration surface. Mounted once, above the chat, by XmppProvider,
 * so an incoming call rings on whatever screen the user happens to be on
 * rather than only inside <Chat>. Renders nothing while `call.phase` is
 * 'idle'.
 */
export const VideoCallOverlay: FC = () => {
  const dispatch = useDispatch();
  const call = useSelector((state: RootState) => state.call);
  const { config } = useChatSettingState();
  const t = useT();

  const videoCallsConfig = config?.videoCalls;
  const enabled = videoCallsConfig?.enabled === true;
  const livekitUrl = (videoCallsConfig?.livekitUrl || '').trim();
  const primaryColor = config?.colors?.primary || DEFAULT_PRIMARY;

  const isOpen = enabled && call.phase !== 'idle';

  // Native incoming-call screen where the host installed react-native-
  // callkeep. No-op otherwise, the in-app ring screen below is the
  // fallback and always renders.
  useCallKeep();

  const [minimized, setMinimized] = useState(false);

  const canRenderSession =
    !!call.token &&
    (call.phase === 'connecting' || call.phase === 'in-call') &&
    !!livekitUrl;
  const isMinimized = minimized && canRenderSession;

  // Reset the minimized flag whenever the call ends, so the next call
  // opens full-screen.
  useEffect(() => {
    if (call.phase === 'idle') {setMinimized(false);}
  }, [call.phase]);

  // Give up on an unanswered outgoing dial.
  useEffect(() => {
    if (call.phase !== 'requesting' || call.direction !== 'outgoing') {
      return;
    }
    const timer = setTimeout(() => {
      dispatch(setCallError(t('call.error.noAnswerTimeout')));
    }, OUTGOING_CALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [call.phase, call.direction, call.startedAt, dispatch, t]);

  // Buzz while an incoming call is ringing. The ring screen is already on
  // top, so this is the only alert needed when the app is in the
  // foreground; a backgrounded/killed app is handled by the call push.
  useEffect(() => {
    const isRinging =
      call.direction === 'incoming' && call.phase === 'ringing-incoming';
    if (!isRinging) {return;}
    Vibration.vibrate(RING_VIBRATION_PATTERN, true);
    return () => Vibration.cancel();
  }, [call.direction, call.phase]);

  const terminateCall = useCallback(
    (state: CallSignalState) => {
      // Write a local "call ended" log entry BEFORE endCall() wipes the
      // call slice. The authoritative entry is a server call-state
      // broadcast, but that isn't guaranteed to arrive, so we synthesize
      // our own. It's deduped against any server copy by callId in
      // addRoomMessage.
      const snap = store.getState().call;
      if (snap.roomJid && (snap.callId || snap.connectedAt)) {
        const durationMs = snap.connectedAt
          ? Math.max(0, Date.now() - snap.connectedAt)
          : 0;
        dispatch(
          addRoomMessage({
            roomJID: snap.roomJid,
            message: buildLocalCallLogMessage({
              callId: snap.callId || '',
              direction:
                snap.direction === 'incoming' ? 'incoming' : 'outgoing',
              durationMs,
              kind: snap.kind === 'audio' ? 'audio' : 'video',
              selfXmppUsername:
                store.getState().chatSettingStore.user?.xmppUsername || '',
            }),
          })
        );
      }
      sendCallStateSignal(state);
      dispatch(endCall());
    },
    [dispatch]
  );

  const declineCall = useCallback(() => {
    sendCallStateSignal('declined');
    dispatch(declineIncomingCall());
  }, [dispatch]);

  const hangupCurrent = useCallback(() => {
    if (call.direction === 'incoming' && call.phase === 'ringing-incoming') {
      declineCall();
    } else if (call.phase === 'error') {
      dispatch(resetCall());
    } else {
      terminateCall(call.phase === 'requesting' ? 'cancelled' : 'ended');
    }
  }, [call.direction, call.phase, declineCall, terminateCall, dispatch]);

  // Android hardware back = hang up, the RN equivalent of the web Esc
  // handler. A minimized panel shouldn't swallow back: the user is using
  // the app underneath it.
  useEffect(() => {
    if (!isOpen || isMinimized || Platform.OS !== 'android') {return;}
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        hangupCurrent();
        return true;
      }
    );
    return () => subscription.remove();
  }, [isOpen, isMinimized, hangupCurrent]);

  const ringingHeader = useMemo(() => {
    if (call.direction === 'incoming') {
      return call.kind === 'audio'
        ? t('call.incomingAudio')
        : t('call.incomingVideo');
    }
    if (call.phase === 'requesting') {return t('call.calling');}
    if (call.phase === 'connecting') {return t('call.connecting');}
    if (call.phase === 'error') {return t('call.failed');}
    return t('call.title');
  }, [call.direction, call.phase, call.kind, t]);

  const ringingSubtitle = useMemo(() => {
    if (call.direction === 'incoming') {
      return call.kind === 'audio' ? t('call.audioCall') : t('call.videoCall');
    }
    if (call.phase === 'connecting') {return t('call.connectingToRoom');}
    if (call.phase === 'error') {return t('call.tryAgainLater');}
    return call.kind === 'audio' ? t('call.audioCall') : t('call.videoCall');
  }, [call.direction, call.kind, call.phase, t]);

  if (!isOpen) {
    return null;
  }

  const showIncomingDecision =
    call.direction === 'incoming' && call.phase === 'ringing-incoming';

  // The minimized session is NOT a Modal: a modal is by definition on top
  // of everything and swallows touches, which is the opposite of what
  // minimize is for (keep talking, keep using the chat). It renders as a
  // floating absolutely-positioned bar instead.
  if (canRenderSession && isMinimized) {
    return (
      <View style={styles.floatingPanel} pointerEvents="box-none">
        <VideoCallSession
          token={call.token as string}
          livekitUrl={livekitUrl}
          kind={call.kind}
          peerName={call.roomName}
          primaryColor={primaryColor}
          icons={videoCallsConfig?.icons}
          startWithCameraOn={videoCallsConfig?.startWithCameraOn}
          startWithMicOn={videoCallsConfig?.startWithMicOn}
          minimized
          onToggleMinimize={() => setMinimized((m) => !m)}
          onConnected={() => dispatch(setCallPhase('in-call'))}
          onError={(message) => dispatch(setCallError(message))}
          onHangup={() => terminateCall('ended')}
        />
      </View>
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={hangupCurrent}
    >
      <View style={styles.backdrop}>
        {canRenderSession ? (
          <View
            style={
              call.kind === 'audio' ? styles.audioSessionCard : styles.sessionCard
            }
          >
            <VideoCallSession
              token={call.token as string}
              livekitUrl={livekitUrl}
              kind={call.kind}
              peerName={call.roomName}
              primaryColor={primaryColor}
              icons={videoCallsConfig?.icons}
              startWithCameraOn={videoCallsConfig?.startWithCameraOn}
              startWithMicOn={videoCallsConfig?.startWithMicOn}
              minimized={false}
              onToggleMinimize={() => setMinimized((m) => !m)}
              onConnected={() => dispatch(setCallPhase('in-call'))}
              onError={(message) => dispatch(setCallError(message))}
              onHangup={() => terminateCall('ended')}
            />
          </View>
        ) : showIncomingDecision ? (
          <RingingCard
            title={ringingHeader}
            subtitle={ringingSubtitle}
            roomName={call.roomName}
            kind={call.kind}
            variant="incoming"
            primaryColor={primaryColor}
            icons={videoCallsConfig?.icons}
            onAccept={() => dispatch(acceptIncomingCall())}
            onDecline={declineCall}
          />
        ) : call.phase === 'error' ? (
          <RingingCard
            title={ringingHeader}
            subtitle={ringingSubtitle}
            roomName={call.roomName}
            kind={call.kind}
            variant="error"
            primaryColor={primaryColor}
            errorMessage={
              call.error ||
              (!livekitUrl ? t('call.error.missingLivekitUrl') : null)
            }
            onDismiss={() => dispatch(resetCall())}
          />
        ) : (
          <RingingCard
            title={ringingHeader}
            subtitle={ringingSubtitle}
            roomName={call.roomName}
            kind={call.kind}
            variant="outgoing"
            primaryColor={primaryColor}
            icons={videoCallsConfig?.icons}
            onHangup={() => terminateCall('cancelled')}
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sessionCard: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  // Audio calls don't need the full video canvas: a fixed tall card leaves
  // a dead gap around the avatar and strands the controls far from
  // anything else, so this one shrink-wraps its content.
  audioSessionCard: {
    width: '100%',
    maxHeight: 600,
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  floatingPanel: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    left: 16,
    zIndex: 1001,
    elevation: 12,
  },
  ringingCard: {
    width: '100%',
    maxWidth: 420,
    padding: 32,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    gap: 24,
  },
  ringingTitle: {
    fontSize: 14,
    color: TEXT_MUTED,
    letterSpacing: 0.2,
  },
  avatarWrap: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
  },
  ringingIdentity: {
    alignItems: 'center',
    gap: 4,
  },
  ringingName: {
    fontSize: 24,
    color: TEXT_PRIMARY,
    textAlign: 'center',
  },
  ringingSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ringingSubtitle: {
    color: TEXT_MUTED,
    fontSize: 14,
  },
  errorBox: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(229, 57, 53, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(229, 57, 53, 0.18)',
  },
  errorBoxText: {
    color: DANGER,
    fontSize: 14,
    textAlign: 'center',
  },
  ringingActions: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButton: {
    minWidth: 120,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  dismissText: {
    color: '#fff',
    fontSize: 15,
  },
});

export default VideoCallOverlay;
