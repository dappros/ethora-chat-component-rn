// RN port of the web MessageNotificationProvider. Renders Telegram-style
// in-app toasts when a new message arrives in a room that is NOT the
// currently visible room. Backed by the global messageNotificationManager,
// which means non-React code (stanza handlers) can push notifications.
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { messageNotificationManager } from '../utils/messageNotificationManager';
import { setCurrentRoom } from '../roomStore/roomsSlice';
import { IConfig, IMessage } from '../types/types';
import { RootState } from '../roomStore';
import { useTheme } from '../hooks/useTheme';
import { ProfileImagePlaceholder } from '../components/MainComponents/ProfileImagePlaceholder';
import { useFileToken } from '../hooks/useFileToken';
import { appendFileToken } from '../helpers/secureFileUrl';

interface ToastItem {
  id: string;
  message: IMessage;
  roomName: string;
  senderName: string;
  roomJID: string;
  timestamp: number;
}

interface MessageNotificationContextValue {
  showMessageNotification: (
    message: IMessage,
    roomName: string,
    senderName: string,
    roomJID: string
  ) => void;
}

const MessageNotificationContext =
  createContext<MessageNotificationContextValue | null>(null);

const DEFAULT_MAX = 3;
const DEFAULT_DURATION_MS = 30000;
// The top banner is a glance, not a stack to work through: it leaves on its
// own after a few seconds unless the host sets `duration`.
const BANNER_DURATION_MS = 4000;
const BANNER_IN_MS = 280;
const BANNER_OUT_MS = 220;

interface ProviderProps {
  children: ReactNode;
  config?: IConfig;
}

export const MessageNotificationProvider: React.FC<ProviderProps> = ({
  children,
  config: propConfig,
}) => {
  const dispatch = useDispatch();
  const contextConfig = useSelector(
    (state: RootState) => state.chatSettingStore?.config
  );
  const visibleRoomJID = useSelector(
    (state: RootState) => state.rooms.visibleRoomJID
  );

  const config = propConfig || contextConfig;
  const notificationConfig = config?.inAppNotifications;
  const isEnabled = notificationConfig?.enabled === true;
  const maxNotifications = notificationConfig?.maxNotifications ?? DEFAULT_MAX;
  // Default presentation: one full-width banner sliding in from the top
  // (the messenger convention). An explicit `position` or a
  // `customComponent` keeps the stacked corner toasts.
  const bannerMode =
    !notificationConfig?.position && !notificationConfig?.customComponent;
  const duration =
    notificationConfig?.duration ??
    (bannerMode ? BANNER_DURATION_MS : DEFAULT_DURATION_MS);
  // The banner times its own exit (so it can animate out); the list prune
  // below is only its safety net.
  const pruneAfter = bannerMode ? duration + 2000 : duration;

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const appActiveRef = useRef(AppState.currentState === 'active');

  // Track AppState — when backgrounded, hold toasts longer; when
  // foregrounded, prune expired.
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        appActiveRef.current = next === 'active';
        if (next === 'active') {
          const now = Date.now();
          setToasts((prev) => prev.filter((t) => now - t.timestamp < pruneAfter));
        }
      }
    );
    return () => sub.remove();
  }, [pruneAfter]);

  // Periodic prune when active.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!appActiveRef.current) {return;}
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < pruneAfter));
    }, 1000);
    return () => clearInterval(interval);
  }, [pruneAfter]);

  // Clear toasts when their room becomes active.
  useEffect(() => {
    if (!visibleRoomJID) {return;}
    setToasts((prev) => prev.filter((t) => t.roomJID !== visibleRoomJID));
  }, [visibleRoomJID]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const navigateToMessage = useCallback(
    (
      roomJID: string,
      messageId: string,
      message: IMessage,
      roomName: string,
      senderName: string
    ) => {
      setToasts((prev) => prev.filter((t) => t.roomJID !== roomJID));
      const customOnClick = notificationConfig?.onClick;
      if (customOnClick) {
        Promise.resolve(
          customOnClick({ roomJID, messageId, message, roomName, senderName })
        ).catch((e) => console.error('onClick handler error', e));
        return;
      }
      if (roomJID) {dispatch(setCurrentRoom({ roomJID }));}
    },
    [dispatch, notificationConfig]
  );

  const showMessageNotification = useCallback(
    (
      message: IMessage,
      roomName: string,
      senderName: string,
      roomJID: string
    ) => {
      if (!isEnabled) {return;}
      // Don't toast for the currently active room.
      if (visibleRoomJID && visibleRoomJID === roomJID) {return;}
      const id = `msg-notification-${message.id}-${Date.now()}`;
      const item: ToastItem = {
        id,
        message,
        roomName,
        senderName,
        roomJID,
        timestamp: Date.now(),
      };
      setToasts((prev) => {
        const next = [...prev, item];
        return next.length > maxNotifications
          ? next.slice(-maxNotifications)
          : next;
      });
    },
    [isEnabled, visibleRoomJID, maxNotifications]
  );

  // Register with the global manager.
  useEffect(() => {
    if (!isEnabled) {return;}
    const unsubscribe = messageNotificationManager.addCallback(
      showMessageNotification
    );
    return unsubscribe;
  }, [isEnabled, showMessageNotification]);

  return (
    <MessageNotificationContext.Provider value={{ showMessageNotification }}>
      {children}
      {isEnabled && bannerMode && toasts.length > 0 && (
        <ToastBanner
          item={toasts[toasts.length - 1]}
          duration={duration}
          safeAreaTop={!!config?.headerLayout?.safeAreaTop}
          onPress={(t) =>
            navigateToMessage(
              t.roomJID,
              t.message.id,
              t.message,
              t.roomName,
              t.senderName
            )
          }
          // One banner stands for everything queued behind it.
          onDismiss={() => setToasts([])}
        />
      )}
      {isEnabled && !bannerMode && toasts.length > 0 && (
        <View
          pointerEvents="box-none"
          style={[
            styles.container,
            positionToStyle(notificationConfig?.position),
          ]}
        >
          {toasts.map((t) => {
            const Custom = notificationConfig?.customComponent;
            if (Custom) {
              return (
                <Custom
                  key={t.id}
                  id={t.id}
                  message={t.message}
                  roomName={t.roomName}
                  senderName={t.senderName}
                  roomJID={t.roomJID}
                  timestamp={t.timestamp}
                  onClose={() => dismiss(t.id)}
                  onNavigateToMessage={navigateToMessage}
                  duration={duration}
                />
              );
            }
            return (
              <ToastRow
                key={t.id}
                item={t}
                onPress={() =>
                  navigateToMessage(
                    t.roomJID,
                    t.message.id,
                    t.message,
                    t.roomName,
                    t.senderName
                  )
                }
                onDismiss={() => dismiss(t.id)}
              />
            );
          })}
        </View>
      )}
    </MessageNotificationContext.Provider>
  );
};

/**
 * Top banner: slides down from under the status bar, stays for `duration`,
 * slides back up. Tap opens the room; a flick upwards dismisses it. A newer
 * message replaces the content in place and restarts the timer.
 */
const ToastBanner: React.FC<{
  item: ToastItem;
  duration: number;
  safeAreaTop: boolean;
  onPress: (item: ToastItem) => void;
  onDismiss: () => void;
}> = ({ item, duration, safeAreaTop, onPress, onDismiss }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const top = (safeAreaTop ? insets.top : 0) + 8;
  const roomIcon = useSelector(
    (state: RootState) => state.rooms.rooms?.[item.roomJID]?.icon
  );
  const fileToken = useFileToken();
  // 0 = hidden above the screen, 1 = in place.
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const leaving = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const leave = useCallback(() => {
    if (leaving.current) {return;}
    leaving.current = true;
    Animated.timing(shown, {
      toValue: 0,
      duration: BANNER_OUT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onDismissRef.current());
  }, [shown]);

  useEffect(() => {
    Animated.timing(shown, {
      toValue: 1,
      duration: BANNER_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [shown]);

  // Restarts with every new message shown in the banner.
  useEffect(() => {
    const timer = setTimeout(leave, duration);
    return () => clearTimeout(timer);
  }, [item.id, duration, leave]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => drag.setValue(Math.min(g.dy, 0)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -24 || g.vy < -0.5) {
          leave();
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  const slide = shown.interpolate({
    inputRange: [0, 1],
    outputRange: [-(top + 96), 0],
  });

  return (
    <Animated.View
      testID="message-notification-banner"
      {...pan.panHandlers}
      style={[
        styles.banner,
        {
          top,
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          opacity: shown,
          transform: [{ translateY: Animated.add(slide, drag) }],
        },
      ]}
    >
      <Pressable style={styles.bannerBody} onPress={() => onPress(item)}>
        <ProfileImagePlaceholder
          name={item.roomName}
          icon={appendFileToken(roomIcon, fileToken)}
          size={40}
        />
        <View style={styles.bannerText}>
          <Text
            style={[styles.bannerTitle, { color: theme.text }]}
            numberOfLines={1}
          >
            {item.roomName}
          </Text>
          <Text
            style={[styles.bannerSubtitle, { color: theme.textSecondary }]}
            numberOfLines={2}
          >
            {item.senderName}: {item.message?.body || ''}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
};

const ToastRow: React.FC<{
  item: ToastItem;
  onPress: () => void;
  onDismiss: () => void;
}> = ({ item, onPress, onDismiss }) => {
  const theme = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [fade]);

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: theme.surface, shadowColor: theme.shadow },
        { opacity: fade },
      ]}
    >
      <Pressable style={styles.toastBody} onPress={onPress}>
        <Text
          style={[styles.toastTitle, { color: theme.text }]}
          numberOfLines={1}
        >
          {item.roomName}
        </Text>
        <Text
          style={[styles.toastSubtitle, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {item.senderName}: {item.message?.body || ''}
        </Text>
      </Pressable>
      <Pressable onPress={onDismiss} style={styles.dismiss}>
        <Text style={[styles.dismissText, { color: theme.textMuted }]}>×</Text>
      </Pressable>
    </Animated.View>
  );
};

const positionToStyle = (
  position?: NonNullable<IConfig['inAppNotifications']>['position']
) => {
  const horizontal = position?.horizontal || 'left';
  const vertical = position?.vertical || 'bottom';
  const offset = position?.offset || {};
  const out: any = {};
  if (vertical === 'top') {
    out.top = offset.top ?? 20;
  } else {
    out.bottom = offset.bottom ?? 20;
  }
  if (horizontal === 'right') {
    out.right = offset.right ?? 20;
    out.alignItems = 'flex-end';
  } else if (horizontal === 'center') {
    out.left = 0;
    out.right = 0;
    out.alignItems = 'center';
  } else {
    out.left = offset.left ?? 20;
    out.alignItems = 'flex-start';
  }
  return out;
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 10000,
    elevation: 10000,
  },
  banner: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 10000,
    elevation: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
  },
  bannerBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  bannerText: {
    flex: 1,
    marginLeft: 12,
  },
  bannerTitle: {
    fontWeight: '600',
    fontSize: 15,
    marginBottom: 2,
  },
  bannerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginVertical: 4,
    borderRadius: 12,
    minWidth: 240,
    maxWidth: 340,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  toastBody: {
    flex: 1,
  },
  toastTitle: {
    fontWeight: '600',
    fontSize: 14,
    color: '#222',
    marginBottom: 2,
  },
  toastSubtitle: {
    fontSize: 12,
    color: '#555',
  },
  dismiss: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dismissText: {
    fontSize: 18,
    color: '#777',
  },
});

export const useMessageNotification = () => {
  const ctx = useContext(MessageNotificationContext);
  if (!ctx) {
    throw new Error(
      'useMessageNotification must be used within a MessageNotificationProvider'
    );
  }
  return ctx;
};
