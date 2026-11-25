import { store } from '../roomStore';
import {
  PushRegistrationError,
  detectPushTokenType,
  pushApiServer,
  registerPushSubscription,
  subscribeToPushGateway,
  unregisterPushSubscription,
} from '../networking/api-requests/push.api';
import {
  getPushDeviceId,
  isPushInstallStoreAvailable,
  loadRememberedPushRegistrations,
  saveRememberedPushRegistrations,
  type RememberedPushRegistration,
} from '../push/pushInstallStore';
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
  /** API base URL the registrations go to; part of what a remembered token belongs to. */
  server: string;
}

interface ServerRegistration extends RegisteredPushToken {
  appId: string;
  xmppUsername: string;
  gateway: boolean;
  language: string;
  server: string;
  /** Sent with the registration; undefined when the install has no id. */
  deviceId?: string;
  registeredAt: number;
}

/**
 * What the SDK holds and what it registered, for a debug screen or a bug
 * report. Tails only, the same ones the backend logs (`tokenTail`,
 * `deviceTail`), so a device can be matched to its rows without the token
 * itself leaving the phone.
 */
export interface PushDiagnostics {
  signedIn: boolean;
  /** Off by `pushNotifications.enabled: false` or the Settings switch. */
  disabled: boolean;
  /** Last 6 characters of the install id; null when the install has none. */
  deviceTail: string | null;
  tokens: Array<{
    tokenType: PushTokenType;
    /** Last 12 characters of the token. */
    tokenTail: string;
    /** On the backend under the signed-in account, as far as this launch knows. */
    registered: boolean;
    registeredAt: number | null;
    encrypted: boolean;
  }>;
  /** The last registration that failed since launch, cleared by the next success. */
  lastError: { message: string; status?: number; at: number } | null;
}

const HOOK_RETRY_MS = 30_000;
// Deleting a token the OS has already replaced is housekeeping: bounded, so
// a request that never answers cannot hold up the ones queued behind it.
const STALE_RELEASE_TIMEOUT_MS = 15_000;
// The install id is a keychain read. One that does not come back must not
// hold the registration: it then goes without the id, as it always did.
const DEVICE_ID_WAIT_MS = 3_000;

const installIdOrNothing = (): Promise<string | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DEVICE_ID_WAIT_MS);
    getPushDeviceId().then(
      (id) => {
        clearTimeout(timer);
        resolve(id);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });

const held = new Map<Slot, RegisteredPushToken>();
const registered = new Map<Slot, ServerRegistration>();
let inflight: Promise<void> | null = null;
let unwatch: (() => void) | null = null;
let hookIdentity: string | null = null;
let hookFailedAt = 0;
let lastError: PushDiagnostics['lastError'] = null;
let tokenListener: { remove?: () => void } | null = null;

const tail = (value: string, length = 12): string => value.slice(-length);

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
    server: pushApiServer(),
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

// The tokens this install registered and has not seen removed, kept across
// launches (pushInstallStore.ts). One update at a time: the two slots are
// released side by side on logout and would lose each other's change.
let rememberedQueue: Promise<void> = Promise.resolve();

const updateRemembered = (
  change: (
    list: RememberedPushRegistration[]
  ) => RememberedPushRegistration[] | Promise<RememberedPushRegistration[]>
): Promise<void> => {
  // Nothing is kept without a store that stays on this device.
  if (!isPushInstallStoreAvailable()) {
    return Promise.resolve();
  }
  const run = rememberedQueue.then(async () => {
    try {
      const list = await loadRememberedPushRegistrations();
      // Not readable right now (no secure store, a locked keychain): leave
      // what is there alone.
      if (!list) {
        return;
      }
      const next = await change(list);
      if (next !== list) {
        await saveRememberedPushRegistrations(next);
      }
    } catch (error) {
      pushLog('warn', 'push: updating the remembered registrations failed', error);
    }
  });
  rememberedQueue = run;
  return run;
};

const sameAccount = (
  entry: RememberedPushRegistration,
  account: { appId: string; xmppUsername: string; server: string }
): boolean =>
  entry.appId === account.appId &&
  entry.xmppUsername === account.xmppUsername &&
  entry.server === account.server;

// The backend no longer has the token (or never will, for this account).
const forgetRemembered = (entry: ServerRegistration): Promise<void> =>
  updateRemembered((list) => {
    const next = list.filter((e) => !(e.token === entry.token && sameAccount(e, entry)));
    return next.length === list.length ? list : next;
  });

// A backend answer that will not change by asking again: the token is not
// there, or this backend has no way to delete it.
const isFinalRefusal = (error: unknown): boolean => {
  const status = (error as PushRegistrationError)?.status;
  return status === 404 || status === 410 || status === 422;
};

// After a token is registered: whatever this install registered before in
// the same slot is a token the OS has replaced since (a restart or a
// reinstall ago), and the backend still pushes to it. Delete the ones of the
// signed-in account, the only ones this session may delete, and remember the
// new token. A backend that knows `deviceId` has dropped them already; the
// delete is then a no-op.
const settleRemembered = (
  token: RegisteredPushToken,
  session: Session
): Promise<void> =>
  updateRemembered(async (list) => {
    const slot = slotOf(token.tokenType);
    const kept: RememberedPushRegistration[] = [];
    for (const entry of list) {
      if (entry.token === token.token) {
        continue;
      }
      if (slotOf(entry.tokenType) === slot && sameAccount(entry, session)) {
        try {
          await unregisterPushSubscription({
            appId: entry.appId,
            token: entry.token,
            authToken: session.authToken,
            timeoutMs: STALE_RELEASE_TIMEOUT_MS,
          });
          pushLog(
            'rn',
            `push: removed the earlier ${entry.tokenType} token …${tail(entry.token)} of this install`
          );
          continue;
        } catch (error) {
          if (isFinalRefusal(error)) {
            continue;
          }
          pushLog(
            'warn',
            `push: could not remove the earlier token …${tail(entry.token)}; will retry`,
            error
          );
        }
      }
      kept.push(entry);
    }
    kept.push({
      token: token.token,
      tokenType: token.tokenType,
      appId: session.appId,
      xmppUsername: session.xmppUsername,
      server: session.server,
    });
    return kept;
  });

const registerOne = async (
  token: RegisteredPushToken,
  session: Session
): Promise<void> => {
  let deviceId: string | undefined;
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
    if (isPushInstallStoreAvailable()) {
      deviceId = (await installIdOrNothing()) ?? undefined;
    }
    await registerPushSubscription({
      appId: session.appId,
      token: token.token,
      tokenType: token.tokenType,
      authToken: session.authToken,
      pushKey: token.pushKey,
      language: session.language || undefined,
      deviceId,
    });
  }
  registered.set(slotOf(token.tokenType), {
    ...token,
    appId: session.appId,
    xmppUsername: session.xmppUsername,
    gateway: isGateway(session),
    language: session.language,
    server: session.server,
    deviceId,
    registeredAt: Date.now(),
  });
  lastError = null;
  pushLog(
    'rn',
    `push: ${token.tokenType} token …${tail(token.token)} registered` +
      (isGateway(session) ? ' (gateway)' : ` for app ${session.appId}`) +
      (deviceId ? `, install …${tail(deviceId, 6)}` : '') +
      (token.pushKey && !isGateway(session) ? ' with a device key (encrypted pushes)' : '') +
      (session.language && !isGateway(session) ? `, language ${session.language}` : '')
  );
  // Not awaited: the registration is done, and neither it nor the next one
  // may wait on a delete of a token that is dead anyway.
  if (!isGateway(session) && isPushInstallStoreAvailable()) {
    settleRemembered(token, session).catch(() => undefined);
  }
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
        await releaseOnServer(previous, session.authToken)
          .then(() => {
            forgetRemembered(previous).catch(() => undefined);
          })
          .catch((error) =>
            pushLog('warn', 'push: releasing the replaced token failed', error)
          );
      }
      await registerOne(token, session);
    }
  })()
    .catch((error) => {
      lastError = {
        message: String((error as Error)?.message || error),
        status: (error as PushRegistrationError)?.status,
        at: Date.now(),
      };
      throw error;
    })
    .finally(() => {
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
  // Only a host that hands tokens to the SDK gets the listener; one that
  // registers them itself is left alone.
  ensureTokenListener();
  return entry;
};

const loadNotifications = (): any => {
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
};

// The OS replaced the token while the app runs. A host on `getPushTokens`
// alone is asked once per signed-in session and would learn of it at the
// next launch only; until then pushes go to a token the device no longer
// listens to. Follows the token the host handed over, never adds one: a
// native token is taken only when the chat token held is of the same kind,
// so an app on Expo push tokens, or on Firebase tokens for iOS, keeps its own.
const onNativeToken = (data: unknown): void => {
  if (typeof data !== 'string' || !data.trim()) {
    return;
  }
  const token = data.trim();
  const chat = held.get('chat');
  if (!chat || chat.token === token || chat.tokenType !== detectPushTokenType(token)) {
    return;
  }
  pushLog('rn', `push: the OS issued a new ${chat.tokenType} token …${tail(token)}`);
  hold(token, chat.tokenType, chat.pushKey);
  registerNow().catch((error) => {
    pushLog('warn', 'push: registering the new token failed', error);
  });
};

const ensureTokenListener = (): void => {
  if (tokenListener) {
    return;
  }
  const notifications = loadNotifications();
  if (typeof notifications?.addPushTokenListener !== 'function') {
    return;
  }
  try {
    tokenListener =
      notifications.addPushTokenListener((event: { data?: unknown }) =>
        onNativeToken(event?.data)
      ) || {};
  } catch (error) {
    pushLog('warn', 'push: could not listen for token changes', error);
  }
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
        .then(() => {
          pushLog(
            'rn',
            `push: ${entry.tokenType} token …${tail(entry.token)} released for app ${entry.appId}`
          );
          // Not awaited: logout waits for the release, not for bookkeeping.
          forgetRemembered(entry).catch(() => undefined);
        })
        // The token stays remembered: if the OS replaces it before this
        // account signs in here again, that sign-in deletes it.
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
    removable.map((entry) =>
      releaseOnServer(entry, session.authToken).then(() => {
        forgetRemembered(entry).catch(() => undefined);
      })
    )
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

/**
 * What the SDK holds and registered, with tails only. For a debug screen or
 * a bug report: `tokenTail` and `deviceTail` are what the backend logs.
 */
export async function getPushDiagnostics(): Promise<PushDiagnostics> {
  const session = readSession();
  const deviceId = await getPushDeviceId();
  return {
    signedIn: !!session.authToken,
    disabled: session.pushDisabled,
    deviceTail: deviceId ? tail(deviceId, 6) : null,
    tokens: SLOTS.map((slot) => held.get(slot))
      .filter((t): t is RegisteredPushToken => !!t)
      .map((token) => {
        const current = registered.get(slotOf(token.tokenType));
        const isRegistered = sameRegistration(token, current, session);
        return {
          tokenType: token.tokenType,
          tokenTail: tail(token.token),
          registered: isRegistered,
          registeredAt: isRegistered && current ? current.registeredAt : null,
          encrypted: !!token.pushKey,
        };
      }),
    lastError: lastError ? { ...lastError } : null,
  };
}

/** Test seam only: lets a test wait for the remembered registrations to settle. */
export const __pushRegistrationIdleForTests = (): Promise<void> => rememberedQueue;

export const __resetPushRegistrationForTests = (): void => {
  held.clear();
  registered.clear();
  inflight = null;
  hookIdentity = null;
  hookFailedAt = 0;
  lastError = null;
  rememberedQueue = Promise.resolve();
  try {
    tokenListener?.remove?.();
  } catch {
    // Nothing to remove.
  }
  tokenListener = null;
  if (unwatch) {
    unwatch();
    unwatch = null;
  }
};
