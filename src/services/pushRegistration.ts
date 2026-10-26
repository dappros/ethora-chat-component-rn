import { store } from '../roomStore';
import {
  PushRegistrationError,
  detectPushTokenType,
  registerPushSubscription,
  subscribeToPushGateway,
  unregisterPushSubscription,
} from '../networking/api-requests/push.api';
import type { PushTokenType } from '../types/types';
import { pushLog } from '../utils/devLogger';

export interface RegisterPushTokenOptions {
  tokenType?: PushTokenType;
  /**
   * Encrypted pushes: base64 of the device's X25519 public key
   * (`ensurePushKeyPair().publicKey`). Sent with the token as `pushKey`;
   * the service seals every chat push for it. A backend without the
   * feature refuses the registration instead of delivering in the clear.
   */
  pushKey?: string;
}

export type RegisterPushTokenOutcome =
  | 'registered'
  | 'deferred'
  | 'disabled';

export interface UnregisterPushTokenOptions {
  tokenType?: PushTokenType;
}

export type UnregisterPushTokenOutcome =
  | 'unregistered'
  | 'forgotten';

export interface RegisteredPushToken {
  token: string;
  tokenType: PushTokenType;
  pushKey?: string;
}

type Slot = 'chat' | 'voip';
const slotOf = (tokenType: PushTokenType): Slot =>
  tokenType === 'apns-voip' ? 'voip' : 'chat';
const SLOTS: Slot[] = ['chat', 'voip'];

interface Session {
  authToken: string;
  appId: string;
  xmppUsername: string;
  projectName: string;
  gatewayUrl: string;
  pushDisabled: boolean;
  language: string;
}

interface ServerRegistration extends RegisteredPushToken {
  appId: string;
  xmppUsername: string;
  gateway: boolean;
  language: string;
}

const HOOK_RETRY_MS = 30_000;

const held = new Map<Slot, RegisteredPushToken>();
const registered = new Map<Slot, ServerRegistration>();
let inflight: Promise<void> | null = null;
let unwatch: (() => void) | null = null;
let hookIdentity: string | null = null;
let hookFailedAt = 0;

const readSession = (): Session => {
  const slice = store.getState().chatSettingStore;
  const user = slice?.user;
  const config = slice?.config;
  return {
    authToken: String(user?.token || ''),
    appId: String(config?.appId || user?.appId || '').trim(),
    xmppUsername: String(user?.xmppUsername || ''),
    projectName: String(config?.projectName || '').trim(),
    gatewayUrl: String(config?.pushNotifications?.apiUrl || '').trim(),
    // The language the backend writes this device's pushes in: the host's
    // config first, then what the user picked in the chat. A change
    // re-registers the token (see sameRegistration), so hosts never call
    // registerPushToken again for it.
    language: String(
      config?.translates?.readerLocale ||
        config?.i18n?.locale ||
        slice?.langSource ||
        slice?.uiLocale ||
        ''
    ).trim(),
    // Off by config (host) or by the user's Settings toggle.
    pushDisabled:
      config?.pushNotifications?.enabled === false ||
      slice?.pushEnabled === false,
  };
};

const isGateway = (session: Session): boolean => !!session.gatewayUrl;

const isReady = (session: Session): boolean =>
  !!session.authToken &&
  (isGateway(session)
    ? !!session.xmppUsername && !!session.projectName
    : !!session.appId);

const sameRegistration = (
  token: RegisteredPushToken,
  current: ServerRegistration | undefined,
  session: Session
): boolean =>
  !!current &&
  current.token === token.token &&
  current.tokenType === token.tokenType &&
  (current.pushKey || '') === (token.pushKey || '') &&
  current.gateway === isGateway(session) &&
  current.appId === session.appId &&
  current.xmppUsername === session.xmppUsername &&
  // The gateway takes no language.
  (current.gateway || current.language === session.language);

// Same device, same account, only the language moved: a plain re-POST
// updates the subscription, no release first.
const onlyLanguageChanged = (
  token: RegisteredPushToken,
  current: ServerRegistration,
  session: Session
): boolean =>
  sameRegistration(token, current, { ...session, language: current.language });

const slotsNeedingRegistration = (session: Session): Slot[] =>
  SLOTS.filter((slot) => {
    const token = held.get(slot);
    return !!token && !sameRegistration(token, registered.get(slot), session);
  });

const releaseOnServer = async (
  current: ServerRegistration,
  authToken: string
): Promise<void> => {
  if (current.gateway || !authToken) {
    return;
  }
  await unregisterPushSubscription({
    appId: current.appId,
    token: current.token,
    authToken,
  });
};

const registerOne = async (
  token: RegisteredPushToken,
  session: Session
): Promise<void> => {
  if (isGateway(session)) {
    if (!session.projectName) {
      throw new PushRegistrationError(
        'registerPushToken: config.projectName is required when ' +
          'pushNotifications.apiUrl points at a push gateway.'
      );
    }
    await subscribeToPushGateway({
      apiUrl: session.gatewayUrl,
      token: token.token,
      userJid: session.xmppUsername,
      projectName: session.projectName,
      authToken: session.authToken,
    });
  } else {
    if (!session.appId) {
      throw new PushRegistrationError(
        'registerPushToken: an app id is required — set config.appId ' +
          'or sign in with a user that carries one.'
      );
    }
    await registerPushSubscription({
      appId: session.appId,
      token: token.token,
      tokenType: token.tokenType,
      authToken: session.authToken,
      pushKey: token.pushKey,
      language: session.language || undefined,
    });
  }
  registered.set(slotOf(token.tokenType), {
    ...token,
    appId: session.appId,
    xmppUsername: session.xmppUsername,
    gateway: isGateway(session),
    language: session.language,
  });
  pushLog(
    'rn',
    `push: ${token.tokenType} token registered` +
      (isGateway(session) ? ' (gateway)' : ` for app ${session.appId}`) +
      (token.pushKey && !isGateway(session) ? ' with a device key (encrypted pushes)' : '') +
      (session.language && !isGateway(session) ? `, language ${session.language}` : '')
  );
};

const registerNow = (): Promise<void> => {
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    const session = readSession();
    if (session.pushDisabled || !session.authToken) {
      return;
    }
    if (isGateway(session) && !session.xmppUsername) {
      return;
    }
    for (const slot of slotsNeedingRegistration(session)) {
      const token = held.get(slot)!;
      const previous = registered.get(slot);
      if (
        previous &&
        previous.xmppUsername === session.xmppUsername &&
        !onlyLanguageChanged(token, previous, session)
      ) {
        registered.delete(slot);
        await releaseOnServer(previous, session.authToken).catch((error) =>
          pushLog('warn', 'push: releasing the replaced token failed', error)
        );
      }
      await registerOne(token, session);
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
};

const runTokenHook = (session: Session): void => {
  const hook = store.getState().chatSettingStore?.config?.pushNotifications
    ?.getPushTokens;
  const identity = session.xmppUsername || session.appId;
  if (!hook || !identity || hookIdentity === identity) {
    return;
  }
  if (Date.now() - hookFailedAt < HOOK_RETRY_MS) {
    return;
  }
  hookIdentity = identity;
  (async () => {
    const result = await hook();
    const list = Array.isArray(result) ? result : result ? [result] : [];
    for (const entry of list) {
      if (typeof entry?.token !== 'string' || !entry.token.trim()) {
        continue;
      }
      hold(entry.token.trim(), entry.tokenType, entry.pushKey);
    }
    await registerNow();
  })().catch((error) => {
    hookIdentity = null;
    hookFailedAt = Date.now();
    pushLog('warn', 'push: getPushTokens failed; will retry', error);
  });
};

const hold = (
  token: string,
  tokenType?: PushTokenType,
  pushKey?: string
): RegisteredPushToken => {
  const resolved = tokenType ?? detectPushTokenType(token);
  const key = typeof pushKey === 'string' ? pushKey.trim() : '';
  const entry: RegisteredPushToken = {
    token,
    tokenType: resolved,
    ...(key ? { pushKey: key } : {}),
  };
  held.set(slotOf(resolved), entry);
  return entry;
};

const ensureWatching = (): void => {
  if (unwatch) {
    return;
  }
  unwatch = store.subscribe(() => {
    const session = readSession();
    if (!session.authToken) {
      hookIdentity = null;
      return;
    }
    if (session.pushDisabled) {
      // Switched off (Settings toggle or config): take the device off the
      // backend but keep the tokens, so switching back on re-registers
      // without the host doing anything. `registered` empties at once,
      // so later store updates do not repeat the release.
      if (registered.size > 0) {
        releasePushRegistration().catch(() => undefined);
      }
      return;
    }
    if (!isReady(session)) {
      return;
    }
    runTokenHook(session);
    if (slotsNeedingRegistration(session).length === 0) {
      return;
    }
    registerNow().catch((error) => {
      pushLog('warn', 'push: deferred token registration failed', error);
    });
  });
};

export const installPushTokenHook = (): void => {
  ensureWatching();
  const session = readSession();
  if (session.authToken && !session.pushDisabled && isReady(session)) {
    runTokenHook(session);
  }
};

export async function registerPushToken(
  token: string,
  options?: RegisterPushTokenOptions
): Promise<RegisterPushTokenOutcome> {
  if (typeof token !== 'string' || !token.trim()) {
    throw new TypeError('registerPushToken: token must be a non-empty string');
  }
  hold(token.trim(), options?.tokenType, options?.pushKey);
  ensureWatching();

  const session = readSession();
  if (session.pushDisabled) {
    return 'disabled';
  }
  if (!session.authToken || (isGateway(session) && !session.xmppUsername)) {
    return 'deferred';
  }
  await registerNow();
  return 'registered';
}

export async function releasePushRegistration(): Promise<void> {
  const current = Array.from(registered.values());
  registered.clear();
  hookIdentity = null;
  const session = readSession();
  if (!current.length || !session.authToken) {
    return;
  }
  await Promise.all(
    current.map((entry) =>
      releaseOnServer(entry, session.authToken)
        .then(() =>
          pushLog('rn', `push: ${entry.tokenType} token released for app ${entry.appId}`)
        )
        .catch((error) =>
          pushLog('warn', 'push: releasing the token on logout failed', error)
        )
    )
  );
}

export async function unregisterPushToken(
  options?: UnregisterPushTokenOptions
): Promise<UnregisterPushTokenOutcome> {
  const slots = options?.tokenType ? [slotOf(options.tokenType)] : SLOTS;
  const toRelease: ServerRegistration[] = [];
  for (const slot of slots) {
    held.delete(slot);
    const current = registered.get(slot);
    if (current) {
      registered.delete(slot);
      toRelease.push(current);
    }
  }
  const session = readSession();
  const removable = toRelease.filter((entry) => !entry.gateway);
  if (!removable.length) {
    return 'forgotten';
  }
  if (!session.authToken) {
    pushLog(
      'warn',
      'push: unregisterPushToken called without a session; the backend still holds the token'
    );
    return 'forgotten';
  }
  const results = await Promise.allSettled(
    removable.map((entry) => releaseOnServer(entry, session.authToken))
  );
  const failure = results.find((r) => r.status === 'rejected') as
    | PromiseRejectedResult
    | undefined;
  if (failure) {
    throw failure.reason;
  }
  return 'unregistered';
}

export const getRegisteredPushToken = (): RegisteredPushToken | null => {
  const chat = held.get('chat');
  return chat ? { ...chat } : null;
};

export const getRegisteredPushTokens = (): RegisteredPushToken[] =>
  SLOTS.map((slot) => held.get(slot))
    .filter((t): t is RegisteredPushToken => !!t)
    .map((t) => ({ ...t }));

export const __resetPushRegistrationForTests = (): void => {
  held.clear();
  registered.clear();
  inflight = null;
  hookIdentity = null;
  hookFailedAt = 0;
  if (unwatch) {
    unwatch();
    unwatch = null;
  }
};
