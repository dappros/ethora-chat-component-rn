/**
 * Public entry points for handing the SDK a push token the HOST obtained
 * itself (Expo's `getExpoPushTokenAsync`, a native FCM/APNs SDK call, or
 * later a PushKit VoIP token). The SDK never requests one on its own and
 * has no Firebase Messaging dependency.
 *
 * `registerPushToken` is safe to call before login (e.g. at app boot,
 * before the user has signed in): the registration is queued and flushed
 * automatically the moment a logged-in user shows up in the store.
 */
import { store } from '../roomStore';
import { pushSubscriptionService } from './pushSubscriptionService';
import { PushProvider, PushTokenRegistration, User } from '../types/types';

const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

// Queued registrations made before the user is logged in. Flushed by the
// store subscription below the moment `isUserReady()` turns true.
let pendingRegistrations: PushTokenRegistration[] = [];
let storeUnsubscribe: (() => void) | null = null;

// Guards the `config.pushNotifications.getPushTokens` hook (see
// `runConfiguredPushTokenFetch`) so it fires once per resolved login, not
// on every XMPP reconnect. Keyed by user identity, reset to `null` after a
// failure so the next reconnect gets to retry.
let lastGetPushTokensIdentity: string | null = null;

// Tokens the host handed over through the public `registerPushToken`. A
// device token belongs to the device, not the login, so after a logout
// these are queued again and follow whoever signs in next. Tokens coming
// from `getPushTokens` are not kept here: that hook simply runs again for
// the next login.
const hostTokens: Map<string, PushTokenRegistration> = new Map();
const hostTokenKey = (r: PushTokenRegistration): string => `${r.provider}:${r.token}`;

const getUser = (): User => store.getState().chatSettingStore.user;

const getUserIdentity = (user: User): string =>
  user?.xmppUsername || user?.defaultWallet?.walletAddress || user?.walletAddress || '';

const isUserReady = (user: User): boolean =>
  !!(user && user.xmppUsername && user.token);

const flushPendingRegistrations = async (): Promise<void> => {
  const user = getUser();
  if (!pendingRegistrations.length || !isUserReady(user)) {return;}

  const projectName = store.getState().chatSettingStore.config?.projectName || '';
  const queued = pendingRegistrations;
  pendingRegistrations = [];

  for (const registration of queued) {
    await pushSubscriptionService.registerToken(registration, user, projectName);
  }
};

/**
 * Installed lazily, the first time something is queued, and torn down once
 * the queue drains, so a host that never calls `registerPushToken` before
 * login doesn't pay for a permanent store subscription.
 */
const ensureFlushSubscription = (): void => {
  if (storeUnsubscribe) {return;}

  storeUnsubscribe = store.subscribe(() => {
    if (!pendingRegistrations.length) {
      storeUnsubscribe?.();
      storeUnsubscribe = null;
      return;
    }

    if (isUserReady(getUser())) {
      flushPendingRegistrations().catch((error) =>
        console.error('[PushTokens] Failed to flush queued registration:', error)
      );
    }
  });
};

/**
 * Hand the SDK a push token obtained by the host app.
 *
 * @param token - The raw token string (e.g. `ExponentPushToken[xxxxxxxx]`,
 *   a native FCM registration token, or an APNs device token).
 * @param options.provider - Where the token came from. `apns-voip` is
 *   reserved for a PushKit VoIP token, register it in ADDITION to the
 *   regular chat token, not instead of it, and only once the backend
 *   supports that provider.
 *
 * An empty token is rejected outright. An `expo` token that doesn't match
 * the `ExponentPushToken[...]` / `ExpoPushToken[...]` shape only logs a
 * warning, still registers, some Expo builds/aliases have shipped both
 * spellings and this SDK shouldn't be the thing that hard-fails on it.
 */
export async function registerPushToken(
  token: string,
  options: { provider: PushProvider }
): Promise<void> {
  if (token) {
    hostTokens.set(hostTokenKey({ token, provider: options.provider }), {
      token,
      provider: options.provider,
    });
  }
  return registerOrQueue(token, options.provider);
}

const registerOrQueue = async (token: string, provider: PushProvider): Promise<void> => {
  if (!token) {
    console.warn('[PushTokens] registerPushToken: empty token, ignoring');
    return;
  }

  if (provider === 'expo' && !EXPO_TOKEN_PATTERN.test(token)) {
    console.warn(
      `[PushTokens] registerPushToken: "${token}" does not look like an Expo push token, registering anyway`
    );
  }

  const registration: PushTokenRegistration = { token, provider };
  const user = getUser();

  if (!isUserReady(user)) {
    pendingRegistrations.push(registration);
    ensureFlushSubscription();
    return;
  }

  const projectName = store.getState().chatSettingStore.config?.projectName || '';
  await pushSubscriptionService.registerToken(registration, user, projectName);
};

/**
 * Unregister a token the host previously registered (e.g. it rotated, or
 * the host is turning push off for this provider). Also drops it from the
 * pending queue in case it was queued but never flushed.
 */
export async function unregisterPushToken(
  token: string,
  options: { provider: PushProvider }
): Promise<void> {
  if (!token) {return;}

  const registration: PushTokenRegistration = { token, provider: options.provider };
  hostTokens.delete(hostTokenKey(registration));
  pendingRegistrations = pendingRegistrations.filter(
    (r) => !(r.token === registration.token && r.provider === registration.provider)
  );

  await pushSubscriptionService.unregisterToken(registration);
}

/**
 * Runs `config.pushNotifications.getPushTokens` (if the host supplied one
 * and push isn't explicitly disabled) and registers whatever it returns.
 *
 * Reads `config` straight from the store instead of taking it as an
 * argument, on purpose: there is no single call site both bootstrap paths
 * share for "first connect of this login". Provider mode (`initBeforeLoad`)
 * does its own inline post-connect sequence in xmppProvider.tsx and calls
 * this there; chat mode's equivalent post-connect step is the
 * `initRoomsPresence` helper (called from useChatWrapperInit.ts and
 * initXmppRooms.tsx), which calls this too. Both modes also share
 * `initializeClient`'s `setOnOnline` handler for every RECONNECT after
 * that. Calling this from all three spots is safe because it is keyed to
 * the resolved user identity below and is a no-op once it has already run
 * for that login, so the host's `getPushTokens()` (which may hit the OS
 * for a token, e.g. Expo's `getExpoPushTokenAsync`) never runs twice for
 * the same login.
 */
export async function runConfiguredPushTokenFetch(): Promise<void> {
  const config = store.getState().chatSettingStore.config;
  if (config?.pushNotifications?.enabled === false) {return;}

  const getPushTokens = config?.pushNotifications?.getPushTokens;
  if (!getPushTokens) {return;}

  const user = getUser();
  if (!isUserReady(user)) {return;}

  const identity = getUserIdentity(user);
  if (!identity || identity === lastGetPushTokensIdentity) {return;}

  lastGetPushTokensIdentity = identity;

  try {
    const result = await getPushTokens();
    const registrations = Array.isArray(result) ? result : result ? [result] : [];
    for (const registration of registrations) {
      if (!registration?.token) {continue;}
      await registerOrQueue(registration.token, registration.provider);
    }
  } catch (error) {
    console.error('[PushTokens] getPushTokens() failed:', error);
    // Let the next online/reconnect try again instead of giving up on
    // this login forever because of one transient failure.
    lastGetPushTokensIdentity = null;
  }
}

/**
 * Called by `logoutService` after the tokens were unregistered for the old
 * login. Re-arms `getPushTokens` for the next login (same user included)
 * and queues the host's imperatively registered tokens again, so the next
 * login gets them without the host calling `registerPushToken` twice.
 */
export function resetPushTokenSession(): void {
  lastGetPushTokensIdentity = null;
  const queued = new Set(pendingRegistrations.map(hostTokenKey));
  for (const [key, registration] of hostTokens) {
    if (!queued.has(key)) {pendingRegistrations.push(registration);}
  }
  if (pendingRegistrations.length) {ensureFlushSubscription();}
}
