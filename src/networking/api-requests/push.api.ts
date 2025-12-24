import axios from 'axios';
import { Platform } from 'react-native';
import { store } from '../../roomStore';

const PUSH_API_URL = 'https://push.ethoradev.com/api/v1';

const pushAxios = axios.create({
  baseURL: PUSH_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PushSubscriptionPayload {
  projectName: string;
  registrationToken: string;
  deviceType: 'web' | 'android' | 'ios';
  jid: string;
}

export async function subscribeToPushNotifications(
  fcmToken: string,
  userJid: string,
  projectName: string = 'Ethora',
): Promise<void> {
  const deviceType: 'web' | 'android' | 'ios' = Platform.select({
    ios: 'ios',
    android: 'android',
    default: 'web',
  }) as 'web' | 'android' | 'ios';

  const payload: PushSubscriptionPayload = {
    projectName,
    registrationToken: fcmToken,
    deviceType,
    jid: `${userJid}@xmpp.ethoradev.com`,
  };

  try {
    const token = store.getState().chatSettingStore?.user?.token || '';

    const response = await pushAxios.post('/subscriptions', 
      // headers: {
      //   Authorization: token,
      // },
      payload
    );
    return;
  } catch (error: any) {
    console.error('Failed to subscribe to push notifications:', error);
  }
}

