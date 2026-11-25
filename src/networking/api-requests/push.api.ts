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

/** The API the registrations go to, as the HTTP client has it right now. */
export const pushApiServer = (): string => String(http.defaults?.baseURL || '');

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

// The backend refused the payload over `deviceId`: it predates the field
// ("deviceId" is not allowed) or takes another shape of it.
const refusesDeviceId = (error: any): boolean =>
  error?.response?.status === 422 &&
  /deviceId/.test(String(error?.response?.data?.error ?? ''));

// Servers that refused `deviceId` since launch: not sent again until the
// next one, so a backend that predates it costs one extra request per
// launch, not one per registration.
const deviceIdRefusedBy = new Set<string>();

/** Test seam only: a new launch. */
export const __resetPushApiForTests = (): void => {
  deviceIdRefusedBy.clear();
};

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
  /**
   * The install the token belongs to (`getPushDeviceId()`): the service
   * replaces the token the same install registered before with this one.
   */
  deviceId?: string;
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
  /** Id of this install (`getPushDeviceId()`); absent when it cannot be kept on the device. */
  deviceId?: string;
}

export const buildPushSubscriptionPayload = (
  token: string,
  tokenType: PushTokenType,
  pushKey?: string,
  pushKeyId?: string,
  language?: string,
  deviceId?: string
): PushSubscriptionPayload => ({
  registrationToken: token,
  deviceType: resolvePushDeviceType(),
  tokenType,
  ...(pushKey
    ? { pushKey, pushKeyAlg: PUSH_KEY_ALG, ...(pushKeyId ? { pushKeyId } : {}) }
    : {}),
  ...(language ? { language } : {}),
  // Last, so a backend that predates several fields names the others first.
  ...(deviceId ? { deviceId } : {}),
});

export async function registerPushSubscription({
  appId,
  token,
  tokenType,
  authToken,
  pushKey,
  pushKeyId,
  language,
  deviceId,
}: RegisterPushSubscriptionArgs): Promise<void> {
  const path = `/v1/push/subscription/${encodeURIComponent(appId)}`;
  const headers = { Authorization: authToken };
  const server = String(http.defaults?.baseURL || '');
  const payload = buildPushSubscriptionPayload(
    token,
    tokenType,
    pushKey,
    pushKeyId,
    language,
    deviceIdRefusedBy.has(server) ? undefined : deviceId
  );
  // Two fields a backend may predate without the registration being worth
  // less than no push at all, so each is retried without, on its own:
  // `deviceId` (the backend then keeps the install's earlier tokens until
  // the SDK deletes them itself) and `language` (pushes come in the
  // backend's default language). Everything else stays in the payload.
  const post = async (body: PushSubscriptionPayload): Promise<void> => {
    let current = body;
    for (;;) {
      try {
        await http.post(path, current, { headers });
        return;
      } catch (error: any) {
        const reduced = { ...current };
        if (current.deviceId && refusesDeviceId(error)) {
          deviceIdRefusedBy.add(server);
          delete reduced.deviceId;
        } else if (current.language && isUnknownFieldError(error)) {
          delete reduced.language;
        } else {
          throw error;
        }
        current = reduced;
      }
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
  /** Give up after this long; absent waits as long as the HTTP client does. */
  timeoutMs?: number;
}

export async function unregisterPushSubscription({
  appId,
  token,
  authToken,
  timeoutMs,
}: UnregisterPushSubscriptionArgs): Promise<void> {
  const headers = { Authorization: authToken };
  const bounded = timeoutMs ? { timeout: timeoutMs } : {};
  try {
    await http.delete(`/v1/push/subscription/${encodeURIComponent(appId)}`, {
      headers,
      data: { registrationToken: token },
      ...bounded,
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
      ...bounded,
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
