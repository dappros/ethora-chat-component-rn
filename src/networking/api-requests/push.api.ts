import axios from 'axios';
import { Platform } from 'react-native';
import { store } from '../../roomStore';
import { PushTokenRegistration } from '../../types/types';

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

const resolveDeviceType = (): 'web' | 'android' | 'ios' =>
  Platform.select({
    ios: 'ios',
    android: 'android',
    default: 'web',
  }) as 'web' | 'android' | 'ios';

const resolveAuthToken = (): string =>
  store.getState().chatSettingStore?.user?.token || '';

export interface PushSubscriptionPayload {
  projectId: string;
  registrationToken: string;
  deviceType: 'web' | 'android' | 'ios';
  jid: string;
  provider: PushTokenRegistration['provider'];
}

/**
 * Register a push token with the backend. Always sends `provider` now, a
 * device can hold several tokens at once (e.g. an expo token for chat and,
 * later, an apns-voip token for calls) and the backend needs it to tell
 * them apart. Throws on failure, the caller (`pushSubscriptionService`)
 * decides whether/how to log it, this module used to swallow the error
 * itself, which hid failures from `isPushSubscribed`-style dedup logic.
 */
export async function subscribeToPushNotifications(
  registration: PushTokenRegistration,
  userJid: string,
  projectName: string = ''
): Promise<void> {
  // `userJid` arrives as either a bare localpart or an already-qualified
  // JID depending on the caller; don't double-qualify it.
  const jid = userJid.includes('@')
    ? userJid
    : `${userJid}@${resolveXmppHost()}`;

  const payload: PushSubscriptionPayload = {
    projectId: projectName,
    registrationToken: registration.token,
    deviceType: resolveDeviceType(),
    jid,
    provider: registration.provider,
  };

  await pushAxios.post('/subscriptions', payload, {
    baseURL: resolvePushApiUrl(),
    headers: {
      Authorization: `Bearer ${resolveAuthToken()}`,
    },
  });
}

/**
 * Unregister a push token from the backend (e.g. on logout, or when the
 * host explicitly calls `unregisterPushToken`). Same DELETE shape as the
 * web SDK's push.api.ts: `data: { endpoint, provider }` identifies the
 * subscription, no jid needed. Throws on failure, same reasoning as above.
 */
export async function unregisterPushToken(
  registration: PushTokenRegistration
): Promise<void> {
  await pushAxios.delete('/subscriptions', {
    baseURL: resolvePushApiUrl(),
    headers: {
      Authorization: `Bearer ${resolveAuthToken()}`,
    },
    data: { endpoint: registration.token, provider: registration.provider },
  });
}
