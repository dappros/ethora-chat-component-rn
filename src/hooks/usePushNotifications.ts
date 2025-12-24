import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import {
  initPushNotifications,
  onForegroundMessage,
  onNotificationOpenedApp,
  getInitialNotification,
} from '../services/pushNotifications';
import { pushSubscriptionService } from '../services/pushSubscriptionService';
import { useSelector } from 'react-redux';
import { RootState } from '../roomStore';
import { useLocalStorage } from './useLocalStorage';

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<any>(null);
  const { user, config } = useSelector((state: RootState) => state.chatSettingStore);

  const { set, get } = useLocalStorage("fcmToken");

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
  }

  useEffect(() => {
    initToken();

    const unsubscribeForeground = onForegroundMessage((message) => {
      setNotification(message);
      
      const { notification: notif, data } = message;
      if (notif) {
        Alert.alert(
          notif.title || 'Notification',
          notif.body || '',
          [{ text: 'OK' }]
        );
      }
    });

    const unsubscribeOpened = onNotificationOpenedApp((message) => {
      setNotification(message);
    });

    getInitialNotification().then((message) => {
      if (message) {
        setNotification(message);
      }
    });

    return () => {
      unsubscribeForeground();
      unsubscribeOpened();
    };
  }, []);

  useEffect(() => {
    if (fcmToken && user && user.xmppPassword && user.defaultWallet?.walletAddress) {
      pushSubscriptionService
        .subscribeToPush(fcmToken, user, config?.projectName)
        .catch((error) => {
          console.error('Failed to subscribe to push:', error);
        });
    }
  }, [fcmToken, user?.defaultWallet?.walletAddress, user?.xmppPassword]);

  return { fcmToken, notification };
}
