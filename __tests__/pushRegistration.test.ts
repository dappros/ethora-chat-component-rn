/**
 * registerPushToken — the host's entry point into push.
 *
 * Pins the backend contract (`POST/DELETE /v1/push/subscription/{appId}`,
 * the endpoints the web SDK and the Ethora RN app use) and the lifecycle
 * the host relies on:
 *   - a token handed over before sign-in is registered on login
 *   - the same token + account is sent once; a new token re-registers
 *   - logout releases the registration on the backend and the next login
 *     registers the same device again
 *   - a backend that predates `tokenType` still gets apns / fcm tokens;
 *     expo tokens are never downgraded into something it cannot deliver to
 *   - `pushNotifications.apiUrl` switches to the legacy gateway contract
 */
jest.mock('axios', () => {
  const fakeHttp: any = jest.fn();
  fakeHttp.post = jest.fn();
  fakeHttp.get = jest.fn();
  fakeHttp.delete = jest.fn();
  fakeHttp.interceptors = {
    response: { use: jest.fn(), eject: jest.fn() },
    request: { use: jest.fn(), eject: jest.fn() },
  };
  fakeHttp.defaults = { baseURL: 'https://test' };
  return {
    __esModule: true,
    default: { create: jest.fn(() => fakeHttp) },
    __fakeHttp: fakeHttp,
  };
});
jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const store = configureStore({
    reducer: { chatSettingStore: chatSettingsReducer },
  });
  return { __esModule: true, store };
});

import axios from 'axios';
import { store } from '../src/roomStore';
import { logout, setConfig, setPushEnabled, setUser } from '../src/roomStore/chatSettingsSlice';
import {
  __resetPushRegistrationForTests,
  getRegisteredPushToken,
  getRegisteredPushTokens,
  installPushTokenHook,
  registerPushToken,
  releasePushRegistration,
  unregisterPushToken,
} from '../src/services/pushRegistration';
import {
  PushRegistrationError,
  buildPushGatewayPayload,
  detectPushTokenType,
  isPushRegistrationError,
} from '../src/networking/api-requests/push.api';

// `__fakeHttp` hangs off the mocked module namespace, not the default export.
const fakeHttp = ((axios as any).__fakeHttp ?? (require('axios') as any).__fakeHttp) as any;

const FCM_TOKEN = 'dGVzdA:APA91bF-fcm-registration-token';
const APNS_TOKEN = 'a'.repeat(64);
const EXPO_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const APP_ID = '6aba84941cd8129eebe00037';

const TEST_CONFIG = {
  appId: APP_ID,
  xmppSettings: { host: 'xmpp.example.com' },
};

// `logout` clears `config` along with the user; in the app the host's
// <Chat> remount dispatches it again before the next login.
const remountWithConfig = (extra: Record<string, unknown> = {}) =>
  store.dispatch(setConfig({ ...TEST_CONFIG, ...extra } as any));

const signIn = (xmppUsername = 'app1_user1', token = 'access-1', appId?: string) => {
  store.dispatch(
    setUser({
      _id: xmppUsername,
      token,
      refreshToken: 'refresh-1',
      xmppPassword: 'pw',
      xmppUsername,
      ...(appId ? { appId } : {}),
    } as any)
  );
};

const flush = async (turns = 10) => {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
};

const lastPost = () => fakeHttp.post.mock.calls[fakeHttp.post.mock.calls.length - 1];
const unknownField = (field: string) => ({
  response: { status: 422, data: { error: `"${field}" is not allowed` } },
});

beforeEach(() => {
  jest.clearAllMocks();
  fakeHttp.post.mockResolvedValue({ data: { success: true } });
  fakeHttp.delete.mockResolvedValue({ data: { success: true } });
  __resetPushRegistrationForTests();
  store.dispatch(logout());
  store.dispatch(setPushEnabled(true));
  remountWithConfig();
});

describe('detectPushTokenType', () => {
  it('tells expo, apns and fcm tokens apart by shape', () => {
    expect(detectPushTokenType(EXPO_TOKEN)).toBe('expo');
    expect(detectPushTokenType('ExpoPushToken[abc]')).toBe('expo');
    expect(detectPushTokenType(APNS_TOKEN)).toBe('apns');
    expect(detectPushTokenType('B'.repeat(64) + '0f')).toBe('apns');
    expect(detectPushTokenType(FCM_TOKEN)).toBe('fcm');
    expect(detectPushTokenType('a'.repeat(63))).toBe('fcm');
    expect(detectPushTokenType('ExponentPushToken[')).toBe('fcm');
  });
});

describe('registerPushToken — main API', () => {
  it('POSTs /v1/push/subscription/{appId} with the user token and resolves "registered"', async () => {
    signIn();
    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('registered');

    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    const [path, payload, options] = lastPost();
    expect(path).toBe(`/v1/push/subscription/${APP_ID}`);
    expect(options.headers.Authorization).toBe('access-1');
    expect(payload).toEqual({
      registrationToken: FCM_TOKEN,
      deviceType: 'ios',
      tokenType: 'fcm',
    });
    expect(getRegisteredPushToken()).toEqual({ token: FCM_TOKEN, tokenType: 'fcm' });
  });

  it('takes the app id from the signed-in user when config has none', async () => {
    store.dispatch(setConfig({ xmppSettings: { host: 'h' } } as any));
    signIn('app1_user1', 'access-1', 'user-app-id');
    await registerPushToken(APNS_TOKEN);
    expect(lastPost()[0]).toBe('/v1/push/subscription/user-app-id');
    expect(lastPost()[1].tokenType).toBe('apns');
  });

  it('sends provider-specific token types (expo, explicit apns-voip)', async () => {
    signIn();
    await registerPushToken(EXPO_TOKEN);
    expect(lastPost()[1]).toEqual({
      registrationToken: EXPO_TOKEN,
      deviceType: 'ios',
      tokenType: 'expo',
    });
    await registerPushToken(APNS_TOKEN, { tokenType: 'apns-voip' });
    expect(lastPost()[1].tokenType).toBe('apns-voip');
  });

  it('falls back to the legacy payload (no tokenType) for apns / fcm on a backend that rejects the field', async () => {
    signIn();
    fakeHttp.post.mockRejectedValueOnce(unknownField('tokenType'));
    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('registered');
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(lastPost()[1]).toEqual({ registrationToken: FCM_TOKEN, deviceType: 'ios' });
  });

  it('never downgrades an expo token: the 422 surfaces with a clear message', async () => {
    signIn();
    fakeHttp.post.mockRejectedValueOnce(unknownField('tokenType'));
    let caught: unknown;
    try {
      await registerPushToken(EXPO_TOKEN);
    } catch (e) {
      caught = e;
    }
    expect(isPushRegistrationError(caught)).toBe(true);
    expect((caught as PushRegistrationError).status).toBe(422);
    expect((caught as PushRegistrationError).message).toContain('Expo');
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('sends the same token for the same account only once', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    await registerPushToken(FCM_TOKEN);
    await registerPushToken(` ${FCM_TOKEN} `);
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('registers again when the token rotates', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    await registerPushToken(`${FCM_TOKEN}-rotated`);
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(lastPost()[1].registrationToken).toBe(`${FCM_TOKEN}-rotated`);
  });

  it('rejects a malformed token without touching the network', async () => {
    signIn();
    await expect(registerPushToken('')).rejects.toBeInstanceOf(TypeError);
    await expect(registerPushToken('   ')).rejects.toBeInstanceOf(TypeError);
    await expect(registerPushToken(undefined as any)).rejects.toBeInstanceOf(TypeError);
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('rejects when signed in but no app id is known anywhere', async () => {
    store.dispatch(setConfig({ xmppSettings: { host: 'h' } } as any));
    signIn();
    await expect(registerPushToken(FCM_TOKEN)).rejects.toMatchObject({
      name: 'PushRegistrationError',
      message: expect.stringContaining('app id'),
    });
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('surfaces a backend refusal with status and body, and retries on the next call', async () => {
    signIn();
    fakeHttp.post.mockRejectedValueOnce({
      response: { status: 403, data: { error: 'Forbidden' } },
    });
    let caught: unknown;
    try {
      await registerPushToken(FCM_TOKEN);
    } catch (e) {
      caught = e;
    }
    const err = caught as PushRegistrationError;
    expect(isPushRegistrationError(err)).toBe(true);
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ error: 'Forbidden' });
    expect(err.message).toContain('403');

    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('registered');
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });

  it('reports an unreachable backend without a status', async () => {
    signIn();
    fakeHttp.post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(registerPushToken(FCM_TOKEN)).rejects.toMatchObject({
      name: 'PushRegistrationError',
      status: undefined,
      message: expect.stringContaining('Network Error'),
    });
  });
});

describe('registerPushToken — lifecycle', () => {
  it('defers a token handed over before sign-in and registers it on login', async () => {
    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('deferred');
    expect(fakeHttp.post).not.toHaveBeenCalled();

    signIn();
    await flush();

    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    expect(lastPost()[2].headers.Authorization).toBe('access-1');
  });

  it('logout releases the registration on the backend (DELETE) and the next login re-registers', async () => {
    signIn('app1_alice', 'access-alice');
    await registerPushToken(FCM_TOKEN);

    // logoutService calls this before dispatching `logout`, i.e. while
    // the access token is still there.
    await releasePushRegistration();
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);
    const [path, options] = fakeHttp.delete.mock.calls[0];
    expect(path).toBe(`/v1/push/subscription/${APP_ID}`);
    expect(options.headers.Authorization).toBe('access-alice');
    expect(options.data).toEqual({ registrationToken: FCM_TOKEN });
    // The token is kept for the next account.
    expect(getRegisteredPushToken()?.token).toBe(FCM_TOKEN);

    store.dispatch(logout());
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);

    remountWithConfig();
    signIn('app1_bob', 'access-bob');
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(lastPost()[2].headers.Authorization).toBe('access-bob');
  });

  it('release falls back to the legacy DELETE /v1/users/endpoints on 404 and never throws', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    fakeHttp.delete
      .mockRejectedValueOnce({ response: { status: 404, data: {} } })
      .mockRejectedValueOnce(new Error('Network Error'));
    await expect(releasePushRegistration()).resolves.toBeUndefined();
    expect(fakeHttp.delete).toHaveBeenCalledTimes(2);
    const [path, options] = fakeHttp.delete.mock.calls[1];
    expect(path).toBe('/v1/users/endpoints');
    expect(options.data).toEqual({ endpoint: FCM_TOKEN });
  });

  it('waits for the config to come back after a logout instead of failing on every store update', async () => {
    signIn('app1_alice');
    await registerPushToken(FCM_TOKEN);
    store.dispatch(logout());

    // Login lands BEFORE the host has re-mounted <Chat> with its config
    // and the user carries no appId: nothing is sent, nothing is thrown.
    signIn('app1_bob', 'access-bob');
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);

    remountWithConfig();
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(lastPost()[2].headers.Authorization).toBe('access-bob');
  });

  it('does not re-send on unrelated store updates once registered', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    remountWithConfig({ dark: true });
    signIn(); // same account, same token
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('honours pushNotifications.enabled: false', async () => {
    remountWithConfig({ pushNotifications: { enabled: false } });
    signIn();
    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('disabled');
    await flush();
    expect(fakeHttp.post).not.toHaveBeenCalled();
    // The token is kept, so flipping the switch on later can use it.
    expect(getRegisteredPushToken()?.token).toBe(FCM_TOKEN);
  });

  it('unregisterPushToken DELETEs on the backend, forgets the token, and no later login re-registers it', async () => {
    signIn('app1_alice', 'access-alice');
    await registerPushToken(FCM_TOKEN);
    await expect(unregisterPushToken()).resolves.toBe('unregistered');
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);
    expect(getRegisteredPushToken()).toBeNull();

    store.dispatch(logout());
    remountWithConfig();
    signIn('app1_bob');
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);

    await registerPushToken(FCM_TOKEN);
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });

  it('unregisterPushToken resolves "forgotten" when nothing was registered on the backend', async () => {
    await registerPushToken(FCM_TOKEN); // deferred, no session
    await expect(unregisterPushToken()).resolves.toBe('forgotten');
    expect(fakeHttp.delete).not.toHaveBeenCalled();
    expect(getRegisteredPushToken()).toBeNull();
  });

  it('unregisterPushToken surfaces a backend refusal but still forgets the token', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    fakeHttp.delete.mockRejectedValueOnce({ response: { status: 500, data: { error: 'boom' } } });
    await expect(unregisterPushToken()).rejects.toMatchObject({
      name: 'PushRegistrationError',
      status: 500,
    });
    expect(getRegisteredPushToken()).toBeNull();
  });

  it('serialises a burst of registrations into one request', async () => {
    signIn();
    await Promise.all([
      registerPushToken(FCM_TOKEN),
      registerPushToken(FCM_TOKEN),
      registerPushToken(FCM_TOKEN),
    ]);
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });
});

describe('legacy push gateway (pushNotifications.apiUrl)', () => {
  const GATEWAY = 'https://push.example.com/api/v1';

  beforeEach(() => {
    remountWithConfig({
      projectName: 'clinic',
      pushNotifications: { apiUrl: GATEWAY },
    });
  });

  it('builds exactly the four keys the gateway schema allows and qualifies the jid', () => {
    expect(
      buildPushGatewayPayload({ token: FCM_TOKEN, userJid: 'app1_user1', projectName: 'clinic' })
    ).toEqual({
      projectName: 'clinic',
      registrationToken: FCM_TOKEN,
      deviceType: 'ios',
      jid: 'app1_user1@xmpp.example.com',
    });
    expect(
      buildPushGatewayPayload({ token: FCM_TOKEN, userJid: 'u@other.host', projectName: 'clinic' }).jid
    ).toBe('u@other.host');
  });

  it('POSTs {apiUrl}/subscriptions with a Bearer token instead of the main API', async () => {
    signIn();
    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('registered');
    const [path, payload, options] = lastPost();
    expect(path).toBe('/subscriptions');
    expect(options.baseURL).toBe(GATEWAY);
    expect(options.headers.Authorization).toBe('Bearer access-1');
    expect(payload).toEqual({
      projectName: 'clinic',
      registrationToken: FCM_TOKEN,
      deviceType: 'ios',
      jid: 'app1_user1@xmpp.example.com',
    });
  });

  it('requires config.projectName', async () => {
    remountWithConfig({ pushNotifications: { apiUrl: GATEWAY } });
    signIn();
    await expect(registerPushToken(FCM_TOKEN)).rejects.toMatchObject({
      name: 'PushRegistrationError',
      message: expect.stringContaining('projectName'),
    });
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('has no unregister route: unregister and release are local only', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    await releasePushRegistration();
    await expect(unregisterPushToken()).resolves.toBe('forgotten');
    expect(fakeHttp.delete).not.toHaveBeenCalled();
  });
});

describe('two slots per device — chat token + apns-voip token', () => {
  const VOIP_TOKEN = 'b'.repeat(64);

  it('holds a chat token and a voip token side by side and registers both', async () => {
    signIn();
    await registerPushToken(EXPO_TOKEN);
    await registerPushToken(VOIP_TOKEN, { tokenType: 'apns-voip' });
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(fakeHttp.post.mock.calls.map((c: any[]) => c[1].tokenType)).toEqual(['expo', 'apns-voip']);
    expect(getRegisteredPushTokens()).toEqual([
      { token: EXPO_TOKEN, tokenType: 'expo' },
      { token: VOIP_TOKEN, tokenType: 'apns-voip' },
    ]);
    expect(getRegisteredPushToken()).toEqual({ token: EXPO_TOKEN, tokenType: 'expo' });
  });

  it('a new chat token replaces the old one: the backend registration is released first', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    await registerPushToken(EXPO_TOKEN);
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);
    expect(fakeHttp.delete.mock.calls[0][1].data).toEqual({ registrationToken: FCM_TOKEN });
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(getRegisteredPushTokens()).toEqual([{ token: EXPO_TOKEN, tokenType: 'expo' }]);
  });

  it('logout releases both slots and the next login registers both again', async () => {
    signIn('app1_alice', 'access-alice');
    await registerPushToken(EXPO_TOKEN);
    await registerPushToken(VOIP_TOKEN, { tokenType: 'apns-voip' });
    await releasePushRegistration();
    expect(fakeHttp.delete).toHaveBeenCalledTimes(2);

    store.dispatch(logout());
    remountWithConfig();
    signIn('app1_bob', 'access-bob');
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(4);
    expect(fakeHttp.post.mock.calls.slice(2).map((c: any[]) => c[1].tokenType).sort()).toEqual([
      'apns-voip',
      'expo',
    ]);
  });

  it('unregisterPushToken({ tokenType }) drops one slot and keeps the other', async () => {
    signIn();
    await registerPushToken(EXPO_TOKEN);
    await registerPushToken(VOIP_TOKEN, { tokenType: 'apns-voip' });
    await expect(unregisterPushToken({ tokenType: 'apns-voip' })).resolves.toBe('unregistered');
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);
    expect(fakeHttp.delete.mock.calls[0][1].data).toEqual({ registrationToken: VOIP_TOKEN });
    expect(getRegisteredPushTokens()).toEqual([{ token: EXPO_TOKEN, tokenType: 'expo' }]);
  });
});

describe('config.pushNotifications.getPushTokens (declarative)', () => {
  it('runs once per login and registers everything it returns', async () => {
    const getPushTokens = jest
      .fn()
      .mockResolvedValue([{ token: EXPO_TOKEN }, { token: 'c'.repeat(64), tokenType: 'apns-voip' }]);
    remountWithConfig({ pushNotifications: { getPushTokens } });
    installPushTokenHook();
    expect(getPushTokens).not.toHaveBeenCalled();

    signIn();
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(1);
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(fakeHttp.post.mock.calls.map((c: any[]) => c[1].tokenType)).toEqual(['expo', 'apns-voip']);

    // Unrelated store updates and a same-account re-dispatch do not re-run it.
    remountWithConfig({ pushNotifications: { getPushTokens }, dark: true });
    signIn();
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(1);
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });

  it('runs again for the next login after a logout', async () => {
    const getPushTokens = jest.fn().mockResolvedValue({ token: FCM_TOKEN });
    remountWithConfig({ pushNotifications: { getPushTokens } });
    installPushTokenHook();
    signIn('app1_alice', 'access-alice');
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(1);

    await releasePushRegistration();
    store.dispatch(logout());
    remountWithConfig({ pushNotifications: { getPushTokens } });
    signIn('app1_bob', 'access-bob');
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(2);
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
  });

  it('a rejected getPushTokens is logged and retried after the back-off, not on every store update', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const getPushTokens = jest
      .fn()
      .mockRejectedValueOnce(new Error('no permission'))
      .mockResolvedValue({ token: FCM_TOKEN });
    remountWithConfig({ pushNotifications: { getPushTokens } });
    installPushTokenHook();
    signIn();
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(1);

    remountWithConfig({ pushNotifications: { getPushTokens }, dark: true });
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(1);

    jest.setSystemTime(1_000_000 + 31_000);
    remountWithConfig({ pushNotifications: { getPushTokens }, dark: false });
    await flush(20);
    expect(getPushTokens).toHaveBeenCalledTimes(2);
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('does nothing while pushNotifications.enabled is false or the session is missing', async () => {
    const getPushTokens = jest.fn().mockResolvedValue({ token: FCM_TOKEN });
    remountWithConfig({ pushNotifications: { getPushTokens, enabled: false } });
    installPushTokenHook();
    signIn();
    await flush(20);
    expect(getPushTokens).not.toHaveBeenCalled();
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('ignores entries without a token and detects the type of the rest', async () => {
    const getPushTokens = jest.fn().mockResolvedValue([{ token: '' }, null, { token: APNS_TOKEN }]);
    remountWithConfig({ pushNotifications: { getPushTokens } });
    installPushTokenHook();
    signIn();
    await flush(20);
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    expect(lastPost()[1]).toMatchObject({ registrationToken: APNS_TOKEN, tokenType: 'apns' });
  });

  it('the Settings push toggle: off releases the registration and keeps the token; on registers again', async () => {
    signIn();
    await registerPushToken(FCM_TOKEN);
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);

    store.dispatch(setPushEnabled(false));
    await flush(20);
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);
    expect(fakeHttp.delete.mock.calls[0][1].data).toEqual({ registrationToken: FCM_TOKEN });
    expect(getRegisteredPushToken()?.token).toBe(FCM_TOKEN);

    // Unrelated store updates while off do not repeat the release.
    remountWithConfig({ dark: true });
    await flush(20);
    expect(fakeHttp.delete).toHaveBeenCalledTimes(1);

    store.dispatch(setPushEnabled(true));
    await flush(20);
    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(lastPost()[1].registrationToken).toBe(FCM_TOKEN);
  });

  it('a token handed over while the Settings toggle is off waits for it to be switched on', async () => {
    store.dispatch(setPushEnabled(false));
    signIn();
    await expect(registerPushToken(FCM_TOKEN)).resolves.toBe('disabled');
    await flush(20);
    expect(fakeHttp.post).not.toHaveBeenCalled();

    store.dispatch(setPushEnabled(true));
    await flush(20);
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });
});
