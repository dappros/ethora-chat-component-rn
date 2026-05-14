// RN port of the web MessageNotificationProvider. Renders Telegram-style
// in-app toasts when a new message arrives in a room that is NOT the
// currently active room. Backed by the global messageNotificationManager,
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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { messageNotificationManager } from '../utils/messageNotificationManager';
import { setCurrentRoom } from '../roomStore/roomsSlice';
import { IConfig, IMessage } from '../types/types';
import { RootState } from '../roomStore';

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
  const activeRoomJID = useSelector(
    (state: RootState) => state.rooms.activeRoomJID
  );

  const config = propConfig || contextConfig;
  const notificationConfig = config?.inAppNotifications;
  const isEnabled = notificationConfig?.enabled === true;
  const maxNotifications = notificationConfig?.maxNotifications ?? DEFAULT_MAX;
  const duration = notificationConfig?.duration ?? DEFAULT_DURATION_MS;

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
          setToasts((prev) => prev.filter((t) => now - t.timestamp < duration));
        }
      }
    );
    return () => sub.remove();
  }, [duration]);

  // Periodic prune when active.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!appActiveRef.current) return;
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < duration));
    }, 1000);
    return () => clearInterval(interval);
  }, [duration]);

  // Clear toasts when their room becomes active.
  useEffect(() => {
    if (!activeRoomJID) return;
    setToasts((prev) => prev.filter((t) => t.roomJID !== activeRoomJID));
  }, [activeRoomJID]);

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
      if (roomJID) dispatch(setCurrentRoom({ roomJID }));
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
      if (!isEnabled) return;
      // Don't toast for the currently active room.
      if (activeRoomJID && activeRoomJID === roomJID) return;
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
    [isEnabled, activeRoomJID, maxNotifications]
  );

  // Register with the global manager.
  useEffect(() => {
    if (!isEnabled) return;
    const unsubscribe = messageNotificationManager.addCallback(
      showMessageNotification
    );
    return unsubscribe;
  }, [isEnabled, showMessageNotification]);

  return (
    <MessageNotificationContext.Provider value={{ showMessageNotification }}>
      {children}
      {isEnabled && toasts.length > 0 && (
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

const ToastRow: React.FC<{
  item: ToastItem;
  onPress: () => void;
  onDismiss: () => void;
}> = ({ item, onPress, onDismiss }) => {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [fade]);

  return (
    <Animated.View style={[styles.toast, { opacity: fade }]}>
      <Pressable style={styles.toastBody} onPress={onPress}>
        <Text style={styles.toastTitle} numberOfLines={1}>
          {item.roomName}
        </Text>
        <Text style={styles.toastSubtitle} numberOfLines={2}>
          {item.senderName}: {item.message?.body || ''}
        </Text>
      </Pressable>
      <Pressable onPress={onDismiss} style={styles.dismiss}>
        <Text style={styles.dismissText}>×</Text>
      </Pressable>
    </Animated.View>
  );
};

const positionToStyle = (position?: IConfig['inAppNotifications']['position']) => {
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
