import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { getApp } from '@react-native-firebase/app';
import { Platform, PermissionsAndroid } from 'react-native';

let appInstance: any;
try {
  appInstance = getApp();
} catch (error) {
}

const AuthorizationStatus = (messaging as any).AuthorizationStatus;

let cachedMessagingInstance: any = null;

const getMessagingInstance = () => {
  if (cachedMessagingInstance) {
    return cachedMessagingInstance;
  }
  
  if (!appInstance) {
    try {
      appInstance = getApp();
    } catch (e) {
    }
  }
  
  cachedMessagingInstance = messaging();
  return cachedMessagingInstance;
};

export async function requestNotificationPermission(): Promise<boolean> {
  const messagingInstance = getMessagingInstance();
  if (Platform.OS === 'ios') {
    const authStatus = await messagingInstance.requestPermission();
    return (
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL
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
    const messagingInstance = getMessagingInstance();
    if (!messagingInstance.isDeviceRegisteredForRemoteMessages) {
      await messagingInstance.registerDeviceForRemoteMessages();
    }
    
    if (Platform.OS === 'ios') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let apnsToken = await messagingInstance.getAPNSToken();
      
      if (!apnsToken) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        apnsToken = await messagingInstance.getAPNSToken();
      }
      
      // No APNS token means push not configured - this is OK for development
      if (!apnsToken) {
        console.log('Push notifications not configured (missing APNs). App will work without push.');
        return null;
      }
    }
    
    const token = await messagingInstance.getToken();
    
    return token;
  } catch (error: any) {
    // Silently handle missing aps-environment (push not configured in Xcode)
    const errorMsg = error?.message || String(error);
    if (errorMsg.includes('aps-environment') || errorMsg.includes('messaging/unknown')) {
      console.log('Push notifications not configured in Xcode. App will work without push.');
      return null;
    }
    console.warn('Error getting FCM token:', error);
    return null;
  }
}

export function onForegroundMessage(
  callback: (message: FirebaseMessagingTypes.RemoteMessage) => void
): () => void {
  const messagingInstance = getMessagingInstance();
  return messagingInstance.onMessage(callback);
}

export function setBackgroundMessageHandler(
  handler: (message: any) => Promise<void>
): void {
  const messagingInstance = getMessagingInstance();
  messagingInstance.setBackgroundMessageHandler(handler);
}

export function onNotificationOpenedApp(
  callback: (message: any) => void
): () => void {
  const messagingInstance = getMessagingInstance();
  return messagingInstance.onNotificationOpenedApp(callback);
}

export async function getInitialNotification(): Promise<any | null> {
  try {
    const messagingInstance = getMessagingInstance();
    const message = await messagingInstance.getInitialNotification();
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

export async function checkNotificationPermission(): Promise<boolean> {
  try {
    const messagingInstance = getMessagingInstance();
    if (Platform.OS === 'ios') {
      try {
        const apnsToken = await messagingInstance.getAPNSToken();
        return apnsToken !== null;
      } catch (error) {
        return false;
      }
    }

    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      return granted;
    }

    return true;
  } catch (error) {
    console.warn('Error checking notification permission:', error);
    return false;
  }
}

export async function disablePushNotifications(): Promise<void> {
  try {
    const messagingInstance = getMessagingInstance();
    await messagingInstance.deleteToken();
    console.log('FCM token deleted successfully');
  } catch (error) {
    console.warn('Error deleting FCM token:', error);
  }
}
