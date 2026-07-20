import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import {
  initPushNotifications,
  onForegroundMessage,
  onNotificationOpenedApp,
  getInitialNotification,
} from '../services/pushNotifications';
import { pushSubscriptionService } from '../services/pushSubscriptionService';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../roomStore';
import { useLocalStorage } from './useLocalStorage';
import { setPendingNotificationJid } from '../roomStore/roomsSlice';
import { handleCallPush } from '../helpers/incomingCallFromPush';

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<any>(null);
  const { user, config } = useSelector((state: RootState) => state.chatSettingStore);
  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const dispatch = useDispatch();

  const { set, get } = useLocalStorage('fcmToken');

  const handleNotificationPress = (remoteMessage: any) => {
    // Tapping a call notification (or launching the app from one) should
    // land on the ring screen, not on the chat room.
    if (handleCallPush(remoteMessage?.data)) {
      return;
    }

    const jid = remoteMessage?.data?.jid || remoteMessage?.data?.chatJid || remoteMessage?.jid;

    if (jid) {
      dispatch(setPendingNotificationJid(jid));
    } else {
      console.warn('No JID found in notification data:', remoteMessage?.data);
    }
  };

  const initToken = async () => {
    try {

      const token = await get();
      if (token) {
        setFcmToken(token as string);
        return;
      }
      const newToken = await initPushNotifications();

      setFcmToken(newToken);
      set(newToken as string);
    } catch (error) {
      console.error('Failed to init token:', error);
    }
  };

  useEffect(() => {
    // initToken is async — `initToken()` without `.catch` leaves any
    // rejection unhandled (showed as `Uncaught (in promise, id: X)` red
    // screen in dev). The inner try/catch covers most paths but any
    // synchronous throw before the try-block ran would still leak.
    initToken().catch((err) =>
      console.warn('[usePushNotifications] initToken rejected', err)
    );

    const unsubscribeForeground = onForegroundMessage((message) => {
      // Calls first: a call push must open the ring screen, never an
      // "OK / Open" alert. handleCallPush returns true for anything
      // call-shaped, so we bail before the chat-notification path.
      if (handleCallPush(message?.data)) {
        return;
      }

      setNotification(message);

      const { notification: notif } = message;
      if (notif) {
        Alert.alert(
          notif.title || 'Notification',
          notif.body || '',
          [
            { text: 'OK' },
            {
              text: 'Open',
              onPress: () => handleNotificationPress(message),
            },
          ]
        );
      }
    });

    const unsubscribeOpened = onNotificationOpenedApp((message) => {
      console.log('[usePushNotifications] App opened from notification:', JSON.stringify(message, null, 2));
      setNotification(message);
      handleNotificationPress(message);
    });

    getInitialNotification()
      .then((message) => {
        if (message) {
          console.log('[usePushNotifications] Initial notification:', JSON.stringify(message, null, 2));
          setNotification(message);
          handleNotificationPress(message);
        }
      })
      .catch((err) =>
        console.warn(
          '[usePushNotifications] getInitialNotification failed',
          err
        )
      );

    return () => {
      unsubscribeForeground();
      unsubscribeOpened();
    };
  }, [rooms]);

  useEffect(() => {
    if (fcmToken && user && user.xmppPassword && user.defaultWallet?.walletAddress) {
      pushSubscriptionService
        .subscribeToPush(fcmToken, user, config?.projectName || '')
        .catch((error) => {
          console.error('Failed to subscribe to push:', error);
        });
    }
  }, [fcmToken, user?.defaultWallet?.walletAddress, user?.xmppPassword]);

  return { fcmToken, notification };
}
