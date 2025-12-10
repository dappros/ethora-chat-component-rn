import messaging from '@react-native-firebase/messaging';
import { Platform, PermissionsAndroid } from 'react-native';

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const authStatus = await messaging().requestPermission();
    return (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
    );
  }

  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  return true;
}

export async function getFCMToken(): Promise<string | null> {
  try {
    if (!messaging().isDeviceRegisteredForRemoteMessages) {
      await messaging().registerDeviceForRemoteMessages();
    }
    
    if (Platform.OS === 'ios') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const apnsToken = await messaging().getAPNSToken();
      if (!apnsToken) {
        console.log('Waiting for APNs token...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    const token = await messaging().getToken();
    console.log('✅ FCM Token:', token);
    return token;
  } catch (error) {
    console.error('Error getting FCM token:', error);
    return null;
  }
}

export function onForegroundMessage(
  callback: (message: any) => void
): () => void {
  return messaging().onMessage(callback);
}

export function setBackgroundMessageHandler(
  handler: (message: any) => Promise<void>
): void {
  messaging().setBackgroundMessageHandler(handler);
}

export async function initPushNotifications(): Promise<string | null> {
  const hasPermission = await requestNotificationPermission();
  
  if (!hasPermission) {
    console.log('Push notification permission denied');
    return null;
  }

  const token = await getFCMToken();
  return token;
}
