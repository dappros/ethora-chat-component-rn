import axios from 'axios';
import { Platform } from 'react-native';
import { store } from '../../roomStore';

// Both of these used to be hardcoded to the ethoradev environment
// (push.ethoradev.com, @xmpp.ethoradev.com). That is a development
// deployment: shipping it inside the SDK meant every host app, including
// production ones, registered its device against dev infrastructure and
// then quietly received no pushes. They are resolved from the host's own
// config now, with the production cluster as the fallback.
const DEFAULT_PUSH_API_URL = 'https://push.chat.ethora.com/api/v1';
const DEFAULT_XMPP_HOST = 'xmpp.chat.ethora.com';

/**
 * Push service base URL. `config.pushNotifications.apiUrl` wins, so a
 * self-hosted or enterprise deployment can point at its own service
 * without forking the SDK.
 */
const resolvePushApiUrl = (): string => {
  const config = store.getState().chatSettingStore?.config;
  return (
    (config?.pushNotifications?.apiUrl || '').trim() || DEFAULT_PUSH_API_URL
  );
};

/**
 * The XMPP host the JID is qualified with. Must match the host the client
 * actually connects to, or the push service files the subscription under a
 * JID nothing ever sends to.
 */
const resolveXmppHost = (): string => {
  const config = store.getState().chatSettingStore?.config;
  return (config?.xmppSettings?.host || '').trim() || DEFAULT_XMPP_HOST;
};

const pushAxios = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PushSubscriptionPayload {
  projectId: string;
  registrationToken: string;
  deviceType: 'web' | 'android' | 'ios';
  jid: string;
}

export async function subscribeToPushNotifications(
  fcmToken: string,
  userJid: string,
  projectName: string = ''
): Promise<void> {
  const deviceType: 'web' | 'android' | 'ios' = Platform.select({
    ios: 'ios',
    android: 'android',
    default: 'web',
  }) as 'web' | 'android' | 'ios';

  // `userJid` arrives as either a bare localpart or an already-qualified
  // JID depending on the caller; don't double-qualify it.
  const jid = userJid.includes('@')
    ? userJid
    : `${userJid}@${resolveXmppHost()}`;

  const payload: PushSubscriptionPayload = {
    projectId: projectName,
    registrationToken: fcmToken,
    deviceType,
    jid,
  };

  try {
    const token = store.getState().chatSettingStore?.user?.token || '';

    const response = await pushAxios.post('/subscriptions', payload, {
      baseURL: resolvePushApiUrl(),
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Failed to subscribe to push notifications:', error);
  }
}
