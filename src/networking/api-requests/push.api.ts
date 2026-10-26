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

/** The only sealing scheme the push service knows (README, "Encrypted pushes"). */
export const PUSH_KEY_ALG = 'sealed-box-x25519';

export interface PushSubscriptionPayload {
  registrationToken: string;
  deviceType: PushDeviceType;
  tokenType?: PushTokenType;
  /**
   * Encrypted pushes: base64 of the device's 32-byte X25519 public key.
   * Absent keeps whatever key the service holds for this token.
   */
  pushKey?: string;
  pushKeyAlg?: typeof PUSH_KEY_ALG;
  pushKeyId?: string;
  /**
   * BCP-47 tag the service writes this device's pushes in. A full tag is
   * fine: the service reduces fr-CA / es-US to fr / es itself.
   */
  language?: string;
}

export interface RegisterPushSubscriptionArgs {
  appId: string;
  token: string;
  tokenType: PushTokenType;
  authToken: string;
  /** Base64 public key for encrypted pushes (`ensurePushKeyPair().publicKey`). */
  pushKey?: string;
  pushKeyId?: string;
  /** Language of this device's pushes (`config.translates.readerLocale` / `i18n.locale`). */
  language?: string;
}

export const buildPushSubscriptionPayload = (
  token: string,
  tokenType: PushTokenType,
  pushKey?: string,
  pushKeyId?: string,
  language?: string
): PushSubscriptionPayload => ({
  registrationToken: token,
  deviceType: resolvePushDeviceType(),
  tokenType,
  ...(pushKey
    ? { pushKey, pushKeyAlg: PUSH_KEY_ALG, ...(pushKeyId ? { pushKeyId } : {}) }
    : {}),
  ...(language ? { language } : {}),
});

export async function registerPushSubscription({
  appId,
  token,
  tokenType,
  authToken,
  pushKey,
  pushKeyId,
  language,
}: RegisterPushSubscriptionArgs): Promise<void> {
  const path = `/v1/push/subscription/${encodeURIComponent(appId)}`;
  const headers = { Authorization: authToken };
  const payload = buildPushSubscriptionPayload(token, tokenType, pushKey, pushKeyId, language);
  // A backend that predates `language` still delivers, in its default
  // language: worth more than no push at all, so that field alone is retried
  // without.
  const post = async (body: PushSubscriptionPayload): Promise<void> => {
    try {
      await http.post(path, body, { headers });
    } catch (error: any) {
      if (!(body.language && isUnknownFieldError(error))) {
        throw error;
      }
      const withoutLanguage = { ...body };
      delete withoutLanguage.language;
      await http.post(path, withoutLanguage, { headers });
    }
  };

  try {
    await post(payload);
    return;
  } catch (error: any) {
    // A backend that predates `tokenType` still delivers to apns / fcm
    // tokens. One that predates `pushKey` would deliver in the clear: the
    // host asked for encryption, so that is an error, never a quiet fallback.
    const canDowngrade = (tokenType === 'apns' || tokenType === 'fcm') && !pushKey;
    if (!(canDowngrade && isUnknownFieldError(error))) {
      throw toRegistrationError(
        error,
        tokenType === 'expo'
          ? 'Push registration (the backend does not accept Expo push tokens yet)'
          : pushKey && isUnknownFieldError(error)
            ? 'Push registration (the backend does not support encrypted pushes)'
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
