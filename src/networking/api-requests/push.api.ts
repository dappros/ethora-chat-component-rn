import axios from 'axios';
import { Platform } from 'react-native';
import { store } from '../../roomStore';
import http from '../apiClient';
import type { PushTokenType } from '../../types/types';

export type { PushTokenType } from '../../types/types';

export type PushDeviceType = 'ios' | 'android' | 'web';

/**
 * Registration failed in a way the host should know about: the backend
 * refused the payload (`status` + `body` carry its answer) or the request
 * never got there (`status` undefined).
 */
export class PushRegistrationError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'PushRegistrationError';
    this.status = status;
    this.body = body;
  }
}

export const isPushRegistrationError = (
  error: unknown
): error is PushRegistrationError =>
  (error as PushRegistrationError)?.name === 'PushRegistrationError';

const EXPO_PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[^\]]+\]$/;
const APNS_TOKEN = /^[0-9a-f]{64,}$/i;

export const detectPushTokenType = (token: string): PushTokenType => {
  const t = token.trim();
  if (EXPO_PUSH_TOKEN.test(t)) {
    return 'expo';
  }
  if (APNS_TOKEN.test(t)) {
    return 'apns';
  }
  return 'fcm';
};

export const resolvePushDeviceType = (): PushDeviceType =>
  Platform.OS === 'ios' ? 'ios' : 'android';

const toRegistrationError = (error: any, what: string): PushRegistrationError => {
  const status: number | undefined = error?.response?.status;
  const body = error?.response?.data;
  const detail =
    (typeof body?.error === 'string' && body.error) ||
    error?.message ||
    'unknown error';
  return new PushRegistrationError(
    status
      ? `${what} refused (HTTP ${status}): ${detail}`
      : `${what} failed: ${detail}`,
    status,
    body
  );
};

const isUnknownFieldError = (error: any): boolean =>
  error?.response?.status === 422 &&
  /not allowed/i.test(String(error?.response?.data?.error ?? ''));

export interface PushSubscriptionPayload {
  registrationToken: string;
  deviceType: PushDeviceType;
  tokenType?: PushTokenType;
}

export interface RegisterPushSubscriptionArgs {
  appId: string;
  token: string;
  tokenType: PushTokenType;
  authToken: string;
}

export const buildPushSubscriptionPayload = (
  token: string,
  tokenType: PushTokenType
): PushSubscriptionPayload => ({
  registrationToken: token,
  deviceType: resolvePushDeviceType(),
  tokenType,
});

export async function registerPushSubscription({
  appId,
  token,
  tokenType,
  authToken,
}: RegisterPushSubscriptionArgs): Promise<void> {
  const path = `/v1/push/subscription/${encodeURIComponent(appId)}`;
  const headers = { Authorization: authToken };
  const payload = buildPushSubscriptionPayload(token, tokenType);

  try {
    await http.post(path, payload, { headers });
    return;
  } catch (error: any) {
    const canDowngrade = tokenType === 'apns' || tokenType === 'fcm';
    if (!(canDowngrade && isUnknownFieldError(error))) {
      throw toRegistrationError(
        error,
        tokenType === 'expo'
          ? 'Push registration (the backend does not accept Expo push tokens yet)'
          : 'Push registration'
      );
    }
  }

  try {
    await http.post(
      path,
      { registrationToken: payload.registrationToken, deviceType: payload.deviceType },
      { headers }
    );
  } catch (error: any) {
    throw toRegistrationError(error, 'Push registration');
  }
}

export interface UnregisterPushSubscriptionArgs {
  appId: string;
  token: string;
  authToken: string;
}

export async function unregisterPushSubscription({
  appId,
  token,
  authToken,
}: UnregisterPushSubscriptionArgs): Promise<void> {
  const headers = { Authorization: authToken };
  try {
    await http.delete(`/v1/push/subscription/${encodeURIComponent(appId)}`, {
      headers,
      data: { registrationToken: token },
    });
    return;
  } catch (error: any) {
    if (error?.response?.status !== 404) {
      throw toRegistrationError(error, 'Push unregistration');
    }
  }
  try {
    await http.delete('/v1/users/endpoints', {
      headers,
      data: { endpoint: token },
    });
  } catch (error: any) {
    throw toRegistrationError(error, 'Push unregistration');
  }
}

const DEFAULT_XMPP_HOST = 'xmpp.chat.ethora.com';

export interface PushGatewaySubscriptionPayload {
  projectName: string;
  registrationToken: string;
  deviceType: PushDeviceType;
  jid: string;
}

export interface GatewaySubscribeArgs {
  apiUrl: string;
  token: string;
  userJid: string;
  projectName: string;
  authToken: string;
}

const resolveXmppHost = (): string => {
  const config = store.getState().chatSettingStore?.config;
  return (config?.xmppSettings?.host || '').trim() || DEFAULT_XMPP_HOST;
};

const gatewayAxios = axios.create({
  headers: { 'Content-Type': 'application/json' },
});

export const buildPushGatewayPayload = ({
  token,
  userJid,
  projectName,
}: Pick<GatewaySubscribeArgs, 'token' | 'userJid' | 'projectName'>): PushGatewaySubscriptionPayload => ({
  projectName,
  registrationToken: token,
  deviceType: resolvePushDeviceType(),
  jid: userJid.includes('@') ? userJid : `${userJid}@${resolveXmppHost()}`,
});

export async function subscribeToPushGateway(
  args: GatewaySubscribeArgs
): Promise<void> {
  try {
    await gatewayAxios.post('/subscriptions', buildPushGatewayPayload(args), {
      baseURL: args.apiUrl,
      headers: { Authorization: `Bearer ${args.authToken}` },
    });
  } catch (error: any) {
    throw toRegistrationError(error, 'Push gateway registration');
  }
}
