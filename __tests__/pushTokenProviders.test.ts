/**
 * Push token providers (feat/push-token-providers).
 *
 * Covers the three layers added so a host app can hand the SDK a push
 * token it obtained itself (Expo, native FCM/APNs, later PushKit VoIP):
 *   - push.api.ts             : payload shape, `provider` field, DELETE shape
 *   - pushSubscriptionService : dedupe, multi-provider, unregister/-all
 *   - pushTokenRegistration   : public registerPushToken/unregisterPushToken,
 *                               pre-login queueing + flush, getPushTokens
 *                               config hook dedup
 *
 * Real redux store (configureStore + the actual chatSettingsSlice), same
 * pattern as apiRequests.test.ts, so dispatching setUser/setConfig drives
 * the modules exactly like the app does. `axios` is mocked directly
 * (push.api.ts talks to the push service via its own axios instance, not
 * the shared apiClient), same pattern as apiClientInterceptor.test.ts.
 */

// ----- mock axios (push.api.ts creates its own instance) -------------
jest.mock('axios', () => {
  const fakeHttp: any = jest.fn();
  fakeHttp.post = jest.fn();
  fakeHttp.delete = jest.fn();
  return {
    __esModule: true,
    default: { create: jest.fn(() => fakeHttp) },
    __fakeHttp: fakeHttp,
  };
});

// ----- mock AsyncStorage (pushSubscriptionService touches it for the
// subscribed-rooms cache; irrelevant here but must not throw) ---------
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

// ----- real store, same wiring as apiRequests.test.ts -----------------
jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const roomsReducer = require('../src/roomStore/roomsSlice').default;
  const store = configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });
  return { __esModule: true, store };
});

import { store } from '../src/roomStore';
import { setUser, setConfig, logout } from '../src/roomStore/chatSettingsSlice';
import {
  subscribeToPushNotifications,
  unregisterPushToken as unregisterPushTokenApi,
} from '../src/networking/api-requests/push.api';
import { pushSubscriptionService } from '../src/services/pushSubscriptionService';
import {
  registerPushToken,
  unregisterPushToken,
  runConfiguredPushTokenFetch,
  resetPushTokenSession,
} from '../src/services/pushTokenRegistration';
import { User } from '../src/types/types';

const fakeHttp = (jest.requireMock('axios') as any).__fakeHttp as {
  post: jest.Mock;
  delete: jest.Mock;
};

const loggedInUser = (overrides: Partial<User> = {}): User =>
  ({
    xmppUsername: 'alice',
    token: 'user-tok',
    defaultWallet: { walletAddress: '0xalice' },
    ...overrides,
  } as User);

beforeEach(() => {
  fakeHttp.post.mockReset().mockResolvedValue({ data: {} });
  fakeHttp.delete.mockReset().mockResolvedValue({ data: {} });
  store.dispatch(logout());
  store.dispatch(setConfig({ projectName: 'proj-1' } as any));
  pushSubscriptionService.reset();
});

// ---- push.api.ts -----------------------------------------------------

describe('push.api.ts', () => {
  it('subscribeToPushNotifications posts the token + provider + jid + deviceType', async () => {
    store.dispatch(setUser(loggedInUser()));

    await subscribeToPushNotifications(
      { token: 'ExponentPushToken[abc]', provider: 'expo' },
      'alice',
      'proj-1'
    );

    expect(fakeHttp.post).toHaveBeenCalledWith(
      '/subscriptions',
      {
        projectId: 'proj-1',
        registrationToken: 'ExponentPushToken[abc]',
        deviceType: 'ios',
        jid: 'alice@xmpp.chat.ethora.com',
        provider: 'expo',
      },
      expect.objectContaining({
        headers: { Authorization: 'Bearer user-tok' },
      })
    );
  });

  it('does not double-qualify an already-qualified jid', async () => {
    store.dispatch(setUser(loggedInUser()));
    await subscribeToPushNotifications(
      { token: 't', provider: 'fcm' },
      'alice@custom.host'
    );
    const [, payload] = fakeHttp.post.mock.calls[0];
    expect(payload.jid).toBe('alice@custom.host');
  });

  it('throws instead of swallowing the error (caller now decides how to log it)', async () => {
    store.dispatch(setUser(loggedInUser()));
    fakeHttp.post.mockRejectedValueOnce(new Error('network down'));
    await expect(
      subscribeToPushNotifications({ token: 't', provider: 'fcm' }, 'alice')
    ).rejects.toThrow('network down');
  });

  it('unregisterPushToken sends DELETE /subscriptions with {endpoint, provider}', async () => {
    store.dispatch(setUser(loggedInUser()));
    await unregisterPushTokenApi({ token: 'tok-1', provider: 'apns-voip' });

    expect(fakeHttp.delete).toHaveBeenCalledWith(
      '/subscriptions',
      expect.objectContaining({
        headers: { Authorization: 'Bearer user-tok' },
        data: { endpoint: 'tok-1', provider: 'apns-voip' },
      })
    );
  });
});

// ---- pushSubscriptionService ------------------------------------------

describe('pushSubscriptionService', () => {
  it('registerToken dedupes the same provider/token/user pair', async () => {
    const user = loggedInUser();
    await pushSubscriptionService.registerToken({ token: 't1', provider: 'expo' }, user, 'p');
    await pushSubscriptionService.registerToken({ token: 't1', provider: 'expo' }, user, 'p');
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('allows multiple providers for the same device/user (expo + apns-voip)', async () => {
    const user = loggedInUser();
    await pushSubscriptionService.registerToken({ token: 'expo-tok', provider: 'expo' }, user, 'p');
    await pushSubscriptionService.registerToken({ token: 'voip-tok', provider: 'apns-voip' }, user, 'p');
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    const providers = fakeHttp.post.mock.calls.map(([, body]) => body.provider);
    expect(providers.sort()).toEqual(['apns-voip', 'expo']);
  });

  it('re-registers the same token after a user switch (identity is part of the dedupe key)', async () => {
    const userA = loggedInUser({ xmppUsername: 'alice' });
    const userB = loggedInUser({ xmppUsername: 'bob' });
    await pushSubscriptionService.registerToken({ token: 'shared-device-tok', provider: 'expo' }, userA, 'p');
    await pushSubscriptionService.registerToken({ token: 'shared-device-tok', provider: 'expo' }, userB, 'p');
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });

  it('logs and swallows a registration failure instead of throwing', async () => {
    fakeHttp.post.mockRejectedValueOnce(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      pushSubscriptionService.registerToken({ token: 't', provider: 'fcm' }, loggedInUser(), 'p')
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('unregisterToken calls the DELETE api and drops the token from the map (no double-unregister)', async () => {
    const user = loggedInUser();
    await pushSubscriptionService.registerToken({ token: 't1', provider: 'expo' }, user, 'p');
    await pushSubscriptionService.unregisterToken({ token: 't1', provider: 'expo' });
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);

    // Re-registering after unregister must hit the network again (not
    // dedupe against a stale map entry).
    await pushSubscriptionService.registerToken({ token: 't1', provider: 'expo' }, user, 'p');
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });

  it('unregisterAllTokens unregisters every provider for this device and clears the map, best-effort', async () => {
    const user = loggedInUser();
    await pushSubscriptionService.registerToken({ token: 'expo-tok', provider: 'expo' }, user, 'p');
    await pushSubscriptionService.registerToken({ token: 'voip-tok', provider: 'apns-voip' }, user, 'p');

    fakeHttp.delete.mockRejectedValueOnce(new Error('one endpoint down'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(pushSubscriptionService.unregisterAllTokens()).resolves.toBeUndefined();
    expect(fakeHttp.delete).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();

    // Best effort: the map is cleared regardless of the one failure above.
    await pushSubscriptionService.registerToken({ token: 'expo-tok', provider: 'expo' }, user, 'p');
    expect(fakeHttp.post).toHaveBeenCalledTimes(3);
  });

  it('reset() clears the registered-token map too', async () => {
    const user = loggedInUser();
    await pushSubscriptionService.registerToken({ token: 't1', provider: 'expo' }, user, 'p');
    await pushSubscriptionService.reset();
    await pushSubscriptionService.registerToken({ token: 't1', provider: 'expo' }, user, 'p');
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });
});

// ---- pushTokenRegistration (public API) --------------------------------

describe('registerPushToken / unregisterPushToken (public API)', () => {
  it('rejects an empty token without touching the network', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await registerPushToken('', { provider: 'expo' });
    expect(fakeHttp.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('registers immediately when the user is already logged in', async () => {
    store.dispatch(setUser(loggedInUser()));
    await registerPushToken('ExponentPushToken[abc]', { provider: 'expo' });
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    const [, body] = fakeHttp.post.mock.calls[0];
    expect(body.provider).toBe('expo');
  });

  it('warns but still registers an expo token that does not match the ExponentPushToken[...] shape', async () => {
    store.dispatch(setUser(loggedInUser()));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await registerPushToken('not-a-real-expo-token', { provider: 'expo' });
    expect(warnSpy).toHaveBeenCalled();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('queues a registration made before login and flushes it once the user becomes available', async () => {
    // Not logged in yet (store was reset to logged-out in beforeEach).
    await registerPushToken('queued-token', { provider: 'fcm' });
    expect(fakeHttp.post).not.toHaveBeenCalled();

    store.dispatch(setUser(loggedInUser()));
    // The flush is driven by a store subscription; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    const [, body] = fakeHttp.post.mock.calls[0];
    expect(body.registrationToken).toBe('queued-token');
    expect(body.provider).toBe('fcm');
  });

  it('unregisterPushToken drops a still-queued (never flushed) registration without a network call', async () => {
    await registerPushToken('never-flushed', { provider: 'apns' });
    await unregisterPushToken('never-flushed', { provider: 'apns' });

    // Logging in afterwards must not flush something that was withdrawn.
    store.dispatch(setUser(loggedInUser()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('unregisterPushToken issues the DELETE for an already-registered token', async () => {
    store.dispatch(setUser(loggedInUser()));
    await registerPushToken('live-token', { provider: 'apns' });
    await unregisterPushToken('live-token', { provider: 'apns' });
    expect(fakeHttp.delete).toHaveBeenCalledWith(
      '/subscriptions',
      expect.objectContaining({ data: { endpoint: 'live-token', provider: 'apns' } })
    );
  });
});

// ---- runConfiguredPushTokenFetch (config.pushNotifications.getPushTokens) --

describe('runConfiguredPushTokenFetch', () => {
  // `runConfiguredPushTokenFetch`'s once-per-login guard is keyed by user
  // identity and lives at module scope (deliberately - see its own
  // comment), so it persists across tests in this file. Each test below
  // uses its own xmppUsername to stay isolated from that guard.
  let counter = 0;
  const nextUser = () => loggedInUser({ xmppUsername: `runner-${++counter}` });

  it('does nothing when getPushTokens is not configured', async () => {
    store.dispatch(setUser(nextUser()));
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: {} } as any));
    await runConfiguredPushTokenFetch();
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('does nothing while pushNotifications.enabled === false', async () => {
    store.dispatch(setUser(nextUser()));
    const getPushTokens = jest.fn(async () => ({ token: 'x', provider: 'expo' as const }));
    store.dispatch(
      setConfig({ projectName: 'p', pushNotifications: { enabled: false, getPushTokens } } as any)
    );
    await runConfiguredPushTokenFetch();
    expect(getPushTokens).not.toHaveBeenCalled();
  });

  it('registers a single returned registration', async () => {
    store.dispatch(setUser(nextUser()));
    const getPushTokens = jest.fn(async () => ({ token: 'single-tok', provider: 'expo' as const }));
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: { getPushTokens } } as any));

    await runConfiguredPushTokenFetch();

    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    const [, body] = fakeHttp.post.mock.calls[0];
    expect(body.registrationToken).toBe('single-tok');
  });

  it('registers every entry of an array result (multiple providers per device)', async () => {
    store.dispatch(setUser(nextUser()));
    const getPushTokens = jest.fn(async () => [
      { token: 'expo-tok', provider: 'expo' as const },
      { token: 'voip-tok', provider: 'apns-voip' as const },
    ]);
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: { getPushTokens } } as any));

    await runConfiguredPushTokenFetch();

    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    const providers = fakeHttp.post.mock.calls.map(([, body]) => body.provider);
    expect(providers.sort()).toEqual(['apns-voip', 'expo']);
  });

  it('calls getPushTokens only once per login identity, even across repeated calls (reconnect storms)', async () => {
    store.dispatch(setUser(nextUser()));
    const getPushTokens = jest.fn(async () => ({ token: 'tok', provider: 'expo' as const }));
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: { getPushTokens } } as any));

    await runConfiguredPushTokenFetch();
    await runConfiguredPushTokenFetch();
    await runConfiguredPushTokenFetch();

    expect(getPushTokens).toHaveBeenCalledTimes(1);
  });

  it('a null/undefined result registers nothing and does not throw', async () => {
    store.dispatch(setUser(nextUser()));
    const getPushTokens = jest.fn(async () => null);
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: { getPushTokens } } as any));
    await expect(runConfiguredPushTokenFetch()).resolves.toBeUndefined();
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });
});

// ---- logout then login again (resetPushTokenSession) ----------------------

describe('re-login after logout', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  // Host tokens live at module scope and earlier tests in this file leave
  // some behind (they follow the next login too, by design), so count
  // only the posts for the token under test.
  const postsFor = (token: string) =>
    fakeHttp.post.mock.calls.filter(([, body]) => body.registrationToken === token).length;

  const logoutFlow = async () => {
    await pushSubscriptionService.unregisterAllTokens();
    resetPushTokenSession();
    await pushSubscriptionService.reset();
    store.dispatch(logout());
  };

  it('re-registers an imperatively registered token for the next login', async () => {
    store.dispatch(setUser(loggedInUser({ xmppUsername: 'relogin-a' })));
    await registerPushToken('ExponentPushToken[relogin]', { provider: 'expo' });
    expect(postsFor('ExponentPushToken[relogin]')).toBe(1);

    await logoutFlow();
    expect(fakeHttp.delete).toHaveBeenCalledWith(
      '/subscriptions',
      expect.objectContaining({ data: { endpoint: 'ExponentPushToken[relogin]', provider: 'expo' } })
    );

    store.dispatch(setUser(loggedInUser({ xmppUsername: 'relogin-a' })));
    await tick();
    expect(postsFor('ExponentPushToken[relogin]')).toBe(2);

    await unregisterPushToken('ExponentPushToken[relogin]', { provider: 'expo' });
  });

  it('runs getPushTokens again when the same user logs back in', async () => {
    const getPushTokens = jest.fn(async () => ({ token: 'cfg-tok', provider: 'expo' as const }));
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: { getPushTokens } } as any));
    store.dispatch(setUser(loggedInUser({ xmppUsername: 'relogin-b' })));
    await runConfiguredPushTokenFetch();

    await logoutFlow();
    store.dispatch(setConfig({ projectName: 'p', pushNotifications: { getPushTokens } } as any));
    store.dispatch(setUser(loggedInUser({ xmppUsername: 'relogin-b' })));
    await runConfiguredPushTokenFetch();

    expect(getPushTokens).toHaveBeenCalledTimes(2);
    expect(postsFor('cfg-tok')).toBe(2);
  });

  it('does not re-queue a token the host unregistered', async () => {
    store.dispatch(setUser(loggedInUser({ xmppUsername: 'relogin-c' })));
    await registerPushToken('gone-token', { provider: 'fcm' });
    await unregisterPushToken('gone-token', { provider: 'fcm' });

    await logoutFlow();
    store.dispatch(setUser(loggedInUser({ xmppUsername: 'relogin-c' })));
    await tick();
    expect(postsFor('gone-token')).toBe(1);
  });
});
