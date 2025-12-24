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
      
      let apnsToken = await messaging().getAPNSToken();
      if (!apnsToken) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        apnsToken = await messaging().getAPNSToken();
      }
    }
    
    const token = await messaging().getToken();
    
    return token;
  } catch (error: any) {
    console.error('Error getting FCM token:', error);
    if (error?.nativeError) {
      console.error('Native error:', error.nativeError);
    }
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

export function onNotificationOpenedApp(
  callback: (message: any) => void
): () => void {
  return messaging().onNotificationOpenedApp(callback);
}

export async function getInitialNotification(): Promise<any | null> {
  try {
    const message = await messaging().getInitialNotification();
    return message;
  } catch (error) {
    console.error('Error getting initial notification:', error);
    return null;
  }
}

export async function initPushNotifications(): Promise<string | null> {
  
  const hasPermission = await requestNotificationPermission();
  
  if (!hasPermission) {
    console.error('Push notification permission denied');
    return null;
  }

  const token = await getFCMToken();
  
  return token;
}
