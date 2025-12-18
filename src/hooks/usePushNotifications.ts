import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import {
  initPushNotifications,
  onForegroundMessage,
} from '../services/pushNotifications';

export function usePushNotifications() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<any>(null);

  useEffect(() => {
    initPushNotifications().then((token) => {
      if (token) {
        setFcmToken(token);
        console.log('✅ FCM Token ready:', token);
        Alert.alert('FCM Token', token.substring(0, 50) + '...');
      }
    });

    const unsubscribe = onForegroundMessage((message) => {
      console.log('Foreground message:', message);
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

    return () => unsubscribe();
  }, []);

  return { fcmToken, notification };
}
