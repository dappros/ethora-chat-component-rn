import React, {
  Component,
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootState } from '../../roomStore';
import {
  acceptIncomingCall,
  declineIncomingCall,
  resetCall,
  setCallError,
} from '../../roomStore/callSlice';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { sendCallStateSignal } from '../../networking/callTokenStanza';
import { useTheme } from '../../hooks/useTheme';
import type { ChatTheme } from '../../theme/theme';
import { VideoCallSession } from './VideoCallSession';
import { startCallSession } from './callSessionController';
import { declineActiveCall, terminateActiveCall } from './callActions';
import {
  CALL_BAR_HEIGHT,
  CALL_BAR_MARGIN_TOP,
  CALL_BAR_MARGIN_X,
  CALL_BAR_RADIUS,
  DockedCallBar,
} from './ActiveCallBar';
import { setCallMinimized, useCallUi } from './callUiStore';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import {
  AudioCallIcon,
  HangUpIcon,
  VideoCallIcon,
} from './CallIcons';
import { VideoCallIcons } from '../../types/types';
import { useT } from '../../i18n/useT';
import { useCallKeep } from './useCallKeep';
import { useOngoingCallNotification } from './useOngoingCallNotification';

const DEFAULT_PRIMARY = '#0052CD';
const DANGER = '#E53935';
const ACCEPT = '#10B981';

// Stop the dial UI sitting forever when the server never broadcasts a
// call-token (offline peer, backend error, etc). 30s matches the typical
// PSTN ring window.
const OUTGOING_CALL_TIMEOUT_MS = 30000;

// Stop ringing an incoming call nobody cancelled. The caller gives up after
// OUTGOING_CALL_TIMEOUT_MS and says so, but that signal is lost when the
// call came in by push and the socket never came up (the system call
// screen of a VoIP push would otherwise ring on).
const INCOMING_CALL_TIMEOUT_MS = 45000;

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
  theme: ChatTheme;
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
  theme,
}) => {
  const t = useT();

  return (
    <View style={[styles.ringingCard, { backgroundColor: theme.surface }]}>
      <Text style={[styles.ringingTitle, { color: theme.textSecondary }]}>{title}</Text>

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
        <Text style={[styles.ringingName, { color: theme.text }]}>
          {roomName ||
            (variant === 'incoming' ? t('call.unknownCaller') : t('call.title'))}
        </Text>
        <View style={styles.ringingSubtitleRow}>
          {kind === 'audio' ? (
            <AudioCallIcon color={theme.textSecondary} size={16} />
          ) : (
            <VideoCallIcon color={theme.textSecondary} size={16} />
          )}
          <Text style={[styles.ringingSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
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
 * The full-screen call, collapsible into the header strip, Telegram-style:
 * pulling it up morphs the whole screen into the green bubble under the
 * header (position, width, height and corner radius all travel together,
 * and the bubble's colour fades in on the way), so it visibly *becomes* the
 * strip rather than leaving and the strip popping in. Let go past a quarter
 * of the way, or flick, and it finishes; released early it springs back.
 * The minimize button runs the same morph; expanding from the strip runs it
 * backwards.
 *
 * Buttons and the draggable video tile handle their own touches; a drag
 * anywhere else on the screen is ours, and only its upward part counts.
 */
const CollapsibleCallSurface: FC<{
  enterFromTop: boolean;
  barColor: string;
  onCollapsed: () => void;
  children: (collapse: () => void) => ReactNode;
}> = ({ enterFromTop, barColor, onCollapsed, children }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { barAnchorY } = useCallUi();
  // Where the bubble sits: under the hosting header, or under the status
  // bar when no header is on screen (the docked fallback).
  const target = {
    top: (barAnchorY ?? insets.top) + CALL_BAR_MARGIN_TOP,
    side: CALL_BAR_MARGIN_X,
    height: CALL_BAR_HEIGHT,
  };
  // 0 = full screen, 1 = the bubble.
  const progress = useRef(new Animated.Value(enterFromTop ? 1 : 0)).current;
  const collapsingRef = useRef(false);
  const onCollapsedRef = useRef(onCollapsed);
  onCollapsedRef.current = onCollapsed;
  const heightRef = useRef(height);
  heightRef.current = height;

  useEffect(() => {
    if (!enterFromTop) {return;}
    Animated.timing(progress, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    // Mount-only: the entrance plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collapse = useCallback(() => {
    if (collapsingRef.current) {return;}
    collapsingRef.current = true;
    Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => onCollapsedRef.current());
  }, [progress]);

  const panHandlers = useMemo(() => {
    const springBack = () =>
      Animated.spring(progress, {
        toValue: 0,
        useNativeDriver: false,
        damping: 22,
        stiffness: 260,
      }).start();
    // How far the finger travels for the full morph.
    const travel = () => heightRef.current * 0.6;
    return PanResponder.create({
      // Claim the touch as soon as it starts on the call screen itself
      // (buttons and the video tile are deeper and win their own touches).
      // Waiting for a move does not work here: the Modal's content sits
      // under the host's screens in the React tree, and an ancestor there
      // (a Pressable / keyboard-dismiss wrapper) takes the touch on start,
      // after which no descendant is ever asked again.
      onStartShouldSetPanResponder: () => !collapsingRef.current,
      onMoveShouldSetPanResponder: () => !collapsingRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        progress.setValue(Math.min(1, Math.max(0, -gesture.dy / travel())));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (-gesture.dy / travel() > 0.25 || gesture.vy < -0.8) {
          collapse();
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    }).panHandlers;
  }, [progress, collapse]);

  const at = (from: number, to: number) =>
    progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

  return (
    <Animated.View
      {...panHandlers}
      style={[
        styles.collapsible,
        {
          top: at(0, target.top),
          left: at(0, target.side),
          width: at(width, width - target.side * 2),
          height: at(height, target.height),
          // Rounded as soon as it starts moving (a card, like the screen's
          // own corners), then tightening to the bubble's radius.
          borderRadius: progress.interpolate({
            inputRange: [0, 0.08, 0.7, 1],
            outputRange: [0, 36, 28, CALL_BAR_RADIUS],
            extrapolate: 'clamp',
          }),
        },
      ]}
    >
      {/* Fixed full-screen size: the content is clipped, never re-laid out
          per frame (the video views would stutter). It fades as the bubble's
          colour takes over. */}
      <Animated.View
        style={[
          styles.sessionFixed,
          {
            width,
            height,
            opacity: progress.interpolate({
              inputRange: [0, 0.55, 0.85],
              outputRange: [1, 0.85, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        {children(collapse)}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: barColor,
            opacity: progress.interpolate({
              inputRange: [0, 0.35, 0.9],
              outputRange: [0, 0, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />
    </Animated.View>
  );
};

/**
 * A crash in the call UI must not take the chat down with it (web wraps
 * the overlay in a silent ChatErrorBoundary). Renders nothing on error and
 * clears itself on the next call.
 */
class CallErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: unknown) {
    console.warn('[calls] call UI crashed', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Call orchestration surface. Mounted once, above the chat, by XmppProvider,
 * so an incoming call rings on whatever screen the user happens to be on
 * rather than only inside <Chat>. Renders nothing while `call.phase` is
 * 'idle'.
 *
 * The LiveKit connection itself lives in callSessionController.ts, so
 * switching between the full-screen Modal and the minimized header strip
 * (two different trees) no longer drops the call.
 */
const VideoCallOverlayInner: FC = () => {
  const dispatch = useDispatch();
  const call = useSelector((state: RootState) => state.call);
  const { config } = useChatSettingState();
  const theme = useTheme();
  const t = useT();

  const videoCallsConfig = config?.videoCalls;
  const enabled = videoCallsConfig?.enabled === true;
  const livekitUrl = (videoCallsConfig?.livekitUrl || '').trim();
  const primaryColor = theme.primary || config?.colors?.primary || DEFAULT_PRIMARY;

  const isOpen = enabled && call.phase !== 'idle';

  // Native incoming-call screen where the host installed react-native-
  // callkeep. No-op otherwise, the in-app ring screen below is the
  // fallback and always renders.
  useCallKeep();
  // Host-provided system notification (Android) with hang up / mute /
  // camera buttons while the call runs.
  useOngoingCallNotification(enabled ? videoCallsConfig?.ongoingCallNotification : undefined);

  // Shared with the header strip (ActiveCallBar), which expands it again.
  const { minimized, systemRinging } = useCallUi();

  const canRenderSession =
    !!call.token &&
    (call.phase === 'connecting' || call.phase === 'in-call') &&
    !!livekitUrl;
  const isMinimized = minimized && canRenderSession;
  // Expanding from the header strip slides the call down from the top
  // instead of fading it in.
  const wasMinimizedRef = useRef(false);
  const enterFromTop = wasMinimizedRef.current && !isMinimized;
  useEffect(() => {
    wasMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  // Join the LiveKit room once the call has a token. Idempotent, and the
  // controller tears itself down when the call slice leaves these phases.
  useEffect(() => {
    if (!enabled || !canRenderSession || !call.token) {return;}
    startCallSession({
      token: call.token,
      livekitUrl,
      kind: call.kind,
      startWithMicOn: videoCallsConfig?.startWithMicOn,
      startWithCameraOn: videoCallsConfig?.startWithCameraOn,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canRenderSession, call.token, livekitUrl, call.kind]);

  // Give up on an unanswered outgoing dial. Unlike web (which only shows
  useEffect(() => {
    if (call.phase !== 'requesting' || call.direction !== 'outgoing') {
      return;
    }
    const timer = setTimeout(() => {
      sendCallStateSignal('cancelled');
      dispatch(setCallError(t('call.error.noAnswerTimeout')));
    }, OUTGOING_CALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [call.phase, call.direction, call.startedAt, dispatch, t]);

  useEffect(() => {
    if (call.phase !== 'ringing-incoming' || call.direction !== 'incoming') {
      return;
    }
    const elapsed = Date.now() - (call.startedAt || Date.now());
    const timer = setTimeout(() => {
      dispatch(declineIncomingCall());
    }, Math.max(0, INCOMING_CALL_TIMEOUT_MS - elapsed));
    return () => clearTimeout(timer);
  }, [call.phase, call.direction, call.startedAt, dispatch]);

  // Buzz while an incoming call is ringing. The ring screen is already on
  // top, so this is the only alert needed when the app is in the
  // foreground; a backgrounded/killed app is handled by the call push.
  useEffect(() => {
    const isRinging =
      call.direction === 'incoming' && call.phase === 'ringing-incoming';
    // CallKit rings (and vibrates) on its own.
    if (!isRinging || systemRinging) {return;}
    Vibration.vibrate(RING_VIBRATION_PATTERN, true);
    return () => Vibration.cancel();
  }, [call.direction, call.phase, systemRinging]);

  const hangupCurrent = useCallback(() => {
    if (call.direction === 'incoming' && call.phase === 'ringing-incoming') {
      declineActiveCall();
    } else if (call.phase === 'error') {
      dispatch(resetCall());
    } else {
      terminateActiveCall(call.phase === 'requesting' ? 'cancelled' : 'ended');
    }
  }, [call.direction, call.phase, dispatch]);

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

  // The system's incoming-call banner is up (iOS CallKit); answering or
  // declining it drives the call from there.
  if (showIncomingDecision && systemRinging) {
    return null;
  }

  const renderSession = (collapse: () => void) => (
    <VideoCallSession
      kind={call.kind}
      peerName={call.roomName}
      primaryColor={primaryColor}
      icons={videoCallsConfig?.icons}
      onToggleMinimize={collapse}
      onHangup={() => terminateActiveCall('ended')}
    />
  );

  // Minimized, the call is a strip under the visible SDK header
  // (HeaderCallBar), Telegram-style, so the chat stays fully usable. With
  // no SDK header on screen the same strip docks to the top instead.
  if (isMinimized) {
    return <DockedCallBar />;
  }

  return (
    <Modal
      visible
      transparent
      animationType={enterFromTop ? 'none' : 'fade'}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={hangupCurrent}
    >
      {canRenderSession ? (
        // Full-bleed: on a phone the call owns the screen, like the native
        // dialer. The audio call keeps the same dark canvas as video.
        <CollapsibleCallSurface
          enterFromTop={enterFromTop}
          barColor={theme.success}
          onCollapsed={() => setCallMinimized(true)}
        >
          {renderSession}
        </CollapsibleCallSurface>
      ) : (
        <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
          {showIncomingDecision ? (
            <RingingCard
              title={ringingHeader}
              subtitle={ringingSubtitle}
              roomName={call.roomName}
              kind={call.kind}
              variant="incoming"
              primaryColor={primaryColor}
              icons={videoCallsConfig?.icons}
              theme={theme}
              onAccept={() => dispatch(acceptIncomingCall())}
              onDecline={declineActiveCall}
            />
          ) : call.phase === 'error' ? (
            <RingingCard
              title={ringingHeader}
              subtitle={ringingSubtitle}
              roomName={call.roomName}
              kind={call.kind}
              variant="error"
              primaryColor={primaryColor}
              theme={theme}
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
              theme={theme}
              onHangup={() => terminateActiveCall('cancelled')}
            />
          )}
        </View>
      )}
    </Modal>
  );
};

export const VideoCallOverlay: FC = () => {
  const callId = useSelector(
    (state: RootState) => state.call.callId || String(state.call.startedAt || '')
  );
  return (
    <CallErrorBoundary resetKey={callId}>
      <VideoCallOverlayInner />
    </CallErrorBoundary>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sessionFull: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  // No flex here: `flex: 1` would override the fixed height and re-lay the
  // call out on every frame of the morph.
  sessionFixed: {
    backgroundColor: '#0B1220',
  },
  collapsible: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#0B1220',
  },
  ringingCard: {
    width: '100%',
    maxWidth: 420,
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    gap: 24,
  },
  ringingTitle: {
    fontSize: 14,
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
    textAlign: 'center',
  },
  ringingSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ringingSubtitle: {
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
