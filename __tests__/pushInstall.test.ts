/**
 * One install, one push token.
 *
 * A push token belongs to the install, not to the user, and the OS replaces
 * it now and then. These pin what keeps a backend from collecting the dead
 * ones, and the device from being left on a token it no longer listens to:
 *   - every registration names the install (`deviceId`), an id kept in the
 *     keychain, on this device only; a backend that predates the field still
 *     gets the registration, with everything else in it
 *   - the tokens the install registered are remembered across launches, so a
 *     token the OS replaced while the app was not running is deleted by the
 *     next registration of the same account
 *   - a logout that could not reach the backend is made good the same way
 *   - a token the OS replaces while the app runs is registered at once,
 *     also for a host that only implements `getPushTokens`
 *   - without a store that stays on the device nothing of this happens and
 *     registration works as before (pushRegistration.test.ts runs that way)
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
  fakeHttp.defaults = { baseURL: 'https://api.one.test' };
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
// The keychain: survives what the tests call a restart (and, on iOS, a
// reinstall). `__control.failReads` is a keychain that does not answer.
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  const control = { failReads: false, thisDeviceOnly: true };
  const key = (name: string, options?: any) => `${options?.keychainService ?? ''}/${name}`;
  return {
    get AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY() {
      return control.thisDeviceOnly ? 7 : undefined;
    },
    getItemAsync: jest.fn(async (name: string, options?: any) => {
      if (control.failReads) {
        throw new Error('errSecInteractionNotAllowed');
      }
      return items.has(key(name, options)) ? items.get(key(name, options)) : null;
    }),
    setItemAsync: jest.fn(async (name: string, value: string, options?: any) => {
      items.set(key(name, options), value);
    }),
    deleteItemAsync: jest.fn(async (name: string, options?: any) => {
      items.delete(key(name, options));
    }),
    __items: items,
    __control: control,
  };
});
jest.mock(
  'expo-notifications',
  () => {
    const listeners = new Set<any>();
    return {
      addPushTokenListener: jest.fn((listener: any) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      }),
      __emit: (data: unknown) => listeners.forEach((listener: any) => listener({ data })),
      __listeners: listeners,
    };
  },
  { virtual: true }
);

import axios from 'axios';
import { store } from '../src/roomStore';
import {
  logout,
  setConfig,
  setPushEnabled,
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import {
  __pushRegistrationIdleForTests,
  __resetPushRegistrationForTests,
  getPushDiagnostics,
  installPushTokenHook,
  registerPushToken as registerPushTokenNow,
  releasePushRegistration,
  unregisterPushToken,
} from '../src/services/pushRegistration';
import {
  PUSH_DEVICE_ID_ITEM,
  PUSH_INSTALL_KEYCHAIN_SERVICE,
  PUSH_REGISTRATIONS_ITEM,
  __resetPushInstallStoreForTests,
  getPushDeviceId,
} from '../src/push/pushInstallStore';
import { __resetSecureStoreRuntimeForTests } from '../src/helpers/secureStoreRuntime';
import { __resetPushApiForTests } from '../src/networking/api-requests/push.api';
import { Platform } from 'react-native';

const fakeHttp = ((axios as any).__fakeHttp ?? (require('axios') as any).__fakeHttp) as any;
const secureStore = require('expo-secure-store') as any;
const notifications = require('expo-notifications') as any;

const APP_ID = '6aba84941cd8129eebe00037';
const TOKEN_1 = '1'.repeat(52) + 'b2e59a68607f';
const TOKEN_2 = '2'.repeat(52) + 'e4d214621b89';
const TOKEN_3 = '3'.repeat(52) + 'd50030995d56';
const TOKEN_4 = '4'.repeat(52) + 'b7b48e57661d';
const VOIP = '9'.repeat(64);

const signIn = (xmppUsername = 'app1_alice', token = `access-${xmppUsername}`) => {
  store.dispatch(setConfig({ appId: APP_ID, xmppSettings: { host: 'xmpp.example.com' } } as any));
  store.dispatch(
    setUser({
      _id: xmppUsername,
      token,
      refreshToken: 'refresh',
      xmppPassword: 'pw',
      xmppUsername,
    } as any)
  );
};

// The registration itself does not wait for the housekeeping that follows it
// (deleting what the OS replaced, remembering the new token); the tests do.
const registerPushToken: typeof registerPushTokenNow = async (...args) => {
  try {
    return await registerPushTokenNow(...args);
  } finally {
    await __pushRegistrationIdleForTests();
  }
};

const flush = async (turns = 30) => {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
};

/** Everything in memory is gone, the keychain is not: a restart, or a reinstall on iOS. */
const restartApp = async () => {
  await __pushRegistrationIdleForTests();
  __resetPushRegistrationForTests();
  __resetPushInstallStoreForTests();
  __resetPushApiForTests();
  store.dispatch(logout());
  store.dispatch(setPushEnabled(true));
  jest.clearAllMocks();
  fakeHttp.post.mockResolvedValue({ data: { success: true } });
  fakeHttp.delete.mockResolvedValue({ data: { ok: true } });
};

const posted = () => fakeHttp.post.mock.calls.map((call: any[]) => call[1]);
const deleted = () =>
  fakeHttp.delete.mock.calls.map((call: any[]) => call[1]?.data?.registrationToken);
const remembered = (): Array<{ token: string; xmppUsername: string }> =>
  JSON.parse(
    secureStore.__items.get(`${PUSH_INSTALL_KEYCHAIN_SERVICE}/${PUSH_REGISTRATIONS_ITEM}`) ?? '[]'
  );
const refused = (message: string, status = 422) => ({
  response: { status, data: { error: message } },
});

beforeEach(async () => {
  secureStore.__items.clear();
  secureStore.__control.failReads = false;
  secureStore.__control.thisDeviceOnly = true;
  __resetSecureStoreRuntimeForTests();
  fakeHttp.defaults.baseURL = 'https://api.one.test';
  await restartApp();
});

describe('the install id', () => {
  it('is 32 hex characters, created once and the same after a restart', async () => {
    const first = await getPushDeviceId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await getPushDeviceId()).toBe(first);

    await restartApp();
    expect(await getPushDeviceId()).toBe(first);
    expect(secureStore.__items.get(`${PUSH_INSTALL_KEYCHAIN_SERVICE}/${PUSH_DEVICE_ID_ITEM}`)).toBe(
      first
    );
  });

  it('is written for this device only, so a backup never carries it to a second phone', async () => {
    await getPushDeviceId();
    const write = secureStore.setItemAsync.mock.calls.find(
      (call: any[]) => call[0] === PUSH_DEVICE_ID_ITEM
    );
    expect(write[2]).toEqual({ keychainService: PUSH_INSTALL_KEYCHAIN_SERVICE, keychainAccessible: 7 });
  });

  it('two calls at once make one id', async () => {
    const [a, b] = await Promise.all([getPushDeviceId(), getPushDeviceId()]);
    expect(a).toBe(b);
    expect(
      secureStore.setItemAsync.mock.calls.filter((call: any[]) => call[0] === PUSH_DEVICE_ID_ITEM)
    ).toHaveLength(1);
  });

  it('a keychain that does not answer gives no id and the stored one is not overwritten', async () => {
    const first = await getPushDeviceId();
    await restartApp();
    secureStore.__control.failReads = true;

    expect(await getPushDeviceId()).toBeNull();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();

    secureStore.__control.failReads = false;
    expect(await getPushDeviceId()).toBe(first);
  });

  it('Android: the keystore keeps it on the device, no accessibility setting needed', async () => {
    const os = Platform.OS;
    (Platform as any).OS = 'android';
    secureStore.__control.thisDeviceOnly = false;
    __resetSecureStoreRuntimeForTests();
    try {
      const id = await getPushDeviceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      const write = secureStore.setItemAsync.mock.calls.find(
        (call: any[]) => call[0] === PUSH_DEVICE_ID_ITEM
      );
      expect(write[2]).toEqual({ keychainService: PUSH_INSTALL_KEYCHAIN_SERVICE });

      signIn();
      await registerPushToken('dGVzdA:APA91bF-fcm-registration-token');
      expect(posted()[0]).toEqual({
        registrationToken: 'dGVzdA:APA91bF-fcm-registration-token',
        deviceType: 'android',
        tokenType: 'fcm',
        deviceId: id,
      });
    } finally {
      (Platform as any).OS = os;
    }
  });

  it('there is none when the store cannot keep it on this device only', async () => {
    secureStore.__control.thisDeviceOnly = false;
    __resetSecureStoreRuntimeForTests();

    expect(await getPushDeviceId()).toBeNull();
    signIn();
    await registerPushToken(TOKEN_1);
    expect(posted()[0]).toEqual({ registrationToken: TOKEN_1, deviceType: 'ios', tokenType: 'apns' });
    // Other parts of the SDK keep their own items there; none of ours.
    expect(
      Array.from(secureStore.__items.keys() as Iterable<string>).filter((key) =>
        key.startsWith(`${PUSH_INSTALL_KEYCHAIN_SERVICE}/`)
      )
    ).toEqual([]);
  });
});

describe('registration names the install', () => {
  it('sends deviceId with the token, the same one for the chat and the VoIP token', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await registerPushToken(VOIP, { tokenType: 'apns-voip' });

    const deviceId = await getPushDeviceId();
    expect(posted().map((p: any) => [p.tokenType, p.deviceId])).toEqual([
      ['apns', deviceId],
      ['apns-voip', deviceId],
    ]);
  });

  it('a backend that predates deviceId gets the same registration without it, nothing else dropped', async () => {
    store.dispatch(
      setConfig({
        appId: APP_ID,
        xmppSettings: { host: 'xmpp.example.com' },
        i18n: { locale: 'uk' },
      } as any)
    );
    store.dispatch(
      setUser({ _id: 'u', token: 'access', refreshToken: 'r', xmppPassword: 'pw', xmppUsername: 'app1_alice' } as any)
    );
    fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
      if (body.deviceId) {
        throw refused('"deviceId" is not allowed');
      }
      return { data: { success: true } };
    });

    await expect(registerPushToken(TOKEN_1, { pushKey: 'k'.repeat(43) + '=' })).resolves.toBe(
      'registered'
    );
    expect(posted()).toHaveLength(2);
    expect(posted()[1]).toEqual({
      registrationToken: TOKEN_1,
      deviceType: 'ios',
      tokenType: 'apns',
      pushKey: 'k'.repeat(43) + '=',
      pushKeyAlg: 'sealed-box-x25519',
      language: 'uk',
    });
  });

  it('a backend that refused deviceId is not offered it again in the same launch, and is at the next', async () => {
    signIn();
    fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
      if (body.deviceId) {
        throw refused('"deviceId" is not allowed');
      }
      return { data: { success: true } };
    });
    await registerPushToken(TOKEN_1);
    expect(posted()).toHaveLength(2);

    await registerPushToken(TOKEN_2);
    expect(posted()).toHaveLength(3);
    expect(posted()[2]).toEqual({ registrationToken: TOKEN_2, deviceType: 'ios', tokenType: 'apns' });

    await restartApp();
    signIn();
    await registerPushToken(TOKEN_2);
    expect(posted()[0].deviceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the older fallbacks work as before with deviceId in the payload', async () => {
    // A backend that predates tokenType (and so everything after it): the
    // legacy body, as in pushRegistration.test.ts.
    signIn();
    fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
      for (const field of ['tokenType', 'language', 'deviceId']) {
        if (field in body) {
          throw refused(`"${field}" is not allowed`);
        }
      }
      return { data: { success: true } };
    });
    await expect(registerPushToken(TOKEN_1)).resolves.toBe('registered');
    expect(posted()[posted().length - 1]).toEqual({ registrationToken: TOKEN_1, deviceType: 'ios' });

    // One that predates pushKey: still an error, never a registration in the clear.
    await restartApp();
    signIn();
    fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
      for (const field of ['pushKey', 'pushKeyAlg', 'deviceId']) {
        if (field in body) {
          throw refused(`"${field}" is not allowed`);
        }
      }
      return { data: { success: true } };
    });
    await expect(
      registerPushToken(TOKEN_1, { pushKey: 'k'.repeat(43) + '=' })
    ).rejects.toThrow(/does not support encrypted pushes/);
    expect(posted().every((body: any) => 'pushKey' in body)).toBe(true);

    // One that does not take Expo tokens: an error, never the legacy body.
    await restartApp();
    signIn();
    fakeHttp.post.mockRejectedValue(refused('"tokenType" must be one of [fcm, apns, apns-voip]'));
    await expect(registerPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).rejects.toThrow(
      /does not accept Expo push tokens/
    );
    expect(posted().every((body: any) => body.tokenType === 'expo')).toBe(true);
  });

  it('a backend that predates both deviceId and language gets it without both', async () => {
    store.dispatch(
      setConfig({ appId: APP_ID, xmppSettings: { host: 'h' }, i18n: { locale: 'uk' } } as any)
    );
    store.dispatch(
      setUser({ _id: 'u', token: 'access', refreshToken: 'r', xmppPassword: 'pw', xmppUsername: 'app1_alice' } as any)
    );
    fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
      if (body.language) {
        throw refused('"language" is not allowed');
      }
      if (body.deviceId) {
        throw refused('"deviceId" is not allowed');
      }
      return { data: { success: true } };
    });

    await expect(registerPushToken(TOKEN_1)).resolves.toBe('registered');
    expect(posted()[posted().length - 1]).toEqual({
      registrationToken: TOKEN_1,
      deviceType: 'ios',
      tokenType: 'apns',
    });
  });

  it('a backend that takes another shape of deviceId still gets the token', async () => {
    signIn();
    fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
      if (body.deviceId) {
        throw refused('"deviceId" with value "x" fails to match the required pattern');
      }
      return { data: { success: true } };
    });

    await expect(registerPushToken(TOKEN_1)).resolves.toBe('registered');
    expect(posted()[1].deviceId).toBeUndefined();
    expect(posted()[1].tokenType).toBe('apns');
  });

  it('a refusal that is not about deviceId is still an error', async () => {
    signIn();
    fakeHttp.post.mockRejectedValue(refused('Forbidden', 403));
    await expect(registerPushToken(TOKEN_1)).rejects.toMatchObject({ status: 403 });
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('the legacy gateway gets no deviceId', async () => {
    store.dispatch(
      setConfig({
        appId: APP_ID,
        projectName: 'proj',
        xmppSettings: { host: 'xmpp.example.com' },
        pushNotifications: { apiUrl: 'https://push.example.com/api/v1' },
      } as any)
    );
    store.dispatch(
      setUser({ _id: 'u', token: 'access', refreshToken: 'r', xmppPassword: 'pw', xmppUsername: 'app1_alice' } as any)
    );
    await registerPushToken(TOKEN_1);
    expect(posted()[0].deviceId).toBeUndefined();
    expect(remembered()).toEqual([]);
  });
});

describe('a token the OS replaced while the app was not running', () => {
  it('is deleted by the next registration of the same account, after the new one is in', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn();
    const order: string[] = [];
    fakeHttp.post.mockImplementation(async (_p: string, body: any) => {
      order.push(`POST ${body.registrationToken.slice(-12)}`);
      return { data: {} };
    });
    fakeHttp.delete.mockImplementation(async (_p: string, options: any) => {
      order.push(`DELETE ${options.data.registrationToken.slice(-12)}`);
      return { data: {} };
    });
    await registerPushToken(TOKEN_2);

    expect(order).toEqual(['POST e4d214621b89', 'DELETE b2e59a68607f']);
    expect(fakeHttp.delete.mock.calls[0][0]).toBe(`/v1/push/subscription/${APP_ID}`);
    expect(fakeHttp.delete.mock.calls[0][1].headers.Authorization).toBe('access-app1_alice');
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_2]);
  });

  it('the same token after a restart is registered again and nothing is deleted', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn();
    await registerPushToken(TOKEN_1);
    expect(posted()).toHaveLength(1);
    expect(fakeHttp.delete).not.toHaveBeenCalled();
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_1]);
  });

  it('four tokens in a row leave one on the backend, not four', async () => {
    // A backend that predates deviceId: the SDK's own deletes are all there is.
    const backend = new Set<string>();
    const serve = () => {
      fakeHttp.post.mockImplementation(async (_path: string, body: any) => {
        if (body.deviceId) {
          throw refused('"deviceId" is not allowed');
        }
        backend.add(body.registrationToken);
        return { data: {} };
      });
      fakeHttp.delete.mockImplementation(async (_path: string, options: any) => {
        backend.delete(options.data.registrationToken);
        return { data: {} };
      });
    };
    for (const token of [TOKEN_1, TOKEN_2, TOKEN_3, TOKEN_4]) {
      await restartApp();
      serve();
      signIn();
      await registerPushToken(token);
    }
    expect(Array.from(backend)).toEqual([TOKEN_4]);
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_4]);
  });

  it('the VoIP token is its own slot: a new chat token does not delete it', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await registerPushToken(VOIP, { tokenType: 'apns-voip' });
    await restartApp();

    signIn();
    await registerPushToken(TOKEN_2);
    expect(deleted()).toEqual([TOKEN_1]);
    expect(remembered().map((e) => e.token).sort()).toEqual([TOKEN_2, VOIP].sort());
  });

  it("another account's token is left alone, and deleted when that account signs in here again", async () => {
    signIn('app1_alice');
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn('app1_bob');
    await registerPushToken(TOKEN_2);
    expect(fakeHttp.delete).not.toHaveBeenCalled();
    expect(remembered().map((e) => [e.xmppUsername, e.token])).toEqual([
      ['app1_alice', TOKEN_1],
      ['app1_bob', TOKEN_2],
    ]);

    await restartApp();
    signIn('app1_alice');
    await registerPushToken(TOKEN_2);
    expect(deleted()).toEqual([TOKEN_1]);
    expect(fakeHttp.delete.mock.calls[0][1].headers.Authorization).toBe('access-app1_alice');
    expect(remembered().map((e) => [e.xmppUsername, e.token])).toEqual([['app1_alice', TOKEN_2]]);
  });

  it('a token registered on another server is not deleted on this one', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    fakeHttp.defaults.baseURL = 'https://api.two.test';
    signIn();
    await registerPushToken(TOKEN_2);
    expect(fakeHttp.delete).not.toHaveBeenCalled();
  });

  it('a delete that did not get through is tried again by the next registration', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn();
    fakeHttp.delete.mockRejectedValue(new Error('Network Error'));
    await expect(registerPushToken(TOKEN_2)).resolves.toBe('registered');
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_1, TOKEN_2]);

    await restartApp();
    signIn();
    await registerPushToken(TOKEN_2);
    expect(deleted()).toEqual([TOKEN_1]);
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_2]);
  });

  it('a backend that says the token is not there is not asked again', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn();
    fakeHttp.delete.mockRejectedValue(refused('Not found', 404));
    await registerPushToken(TOKEN_2);
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_2]);
  });

  it('a keychain that does not answer keeps what is remembered', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    secureStore.__control.failReads = true;
    signIn();
    await expect(registerPushToken(TOKEN_2)).resolves.toBe('registered');
    expect(fakeHttp.delete).not.toHaveBeenCalled();
    expect(posted()[0].deviceId).toBeUndefined();

    secureStore.__control.failReads = false;
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_1]);
  });
});

describe('housekeeping never holds up what the host waits for', () => {
  const within = <T,>(promise: Promise<T>) =>
    Promise.race([
      promise.then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('stuck'), 300)),
    ]);

  it('a delete of a replaced token that never answers blocks neither the registration, nor the next one, nor a logout', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn();
    let releaseHung = 0;
    let timeOut: (error: Error) => void = () => undefined;
    fakeHttp.delete.mockImplementation((_path: string, options: any) => {
      if (options.data.registrationToken === TOKEN_1) {
        releaseHung += 1;
        // The first try never answers; later ones fail at once.
        return releaseHung === 1
          ? new Promise((_resolve, reject) => {
              timeOut = reject;
            })
          : Promise.reject(new Error('Network Error'));
      }
      return Promise.resolve({ data: {} });
    });

    expect(await within(registerPushTokenNow(TOKEN_2))).toBe('done');
    expect(releaseHung).toBe(1);
    expect(await within(registerPushTokenNow(TOKEN_3))).toBe('done');
    expect(posted().map((p: any) => p.registrationToken)).toEqual([TOKEN_2, TOKEN_3]);
    expect(await within(releasePushRegistration())).toBe('done');
    expect(deleted()).toEqual([TOKEN_1, TOKEN_2, TOKEN_3]);

    // What the request's own timeout does on a device; the token is kept
    // for the next try.
    timeOut(new Error('timeout of 15000ms exceeded'));
    await __pushRegistrationIdleForTests();
    expect(remembered().map((e) => e.token)).toContain(TOKEN_1);
  });

  it('the delete of a replaced token is bounded, the logout release is as it was', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await restartApp();

    signIn();
    await registerPushToken(TOKEN_2);
    expect(fakeHttp.delete.mock.calls[0][1].timeout).toBe(15000);

    await releasePushRegistration();
    expect(fakeHttp.delete.mock.calls[1][1].timeout).toBeUndefined();
  });

  it('the SDK does not listen for tokens until the host has handed one over', async () => {
    signIn();
    installPushTokenHook();
    await flush();
    expect(notifications.addPushTokenListener).not.toHaveBeenCalled();

    await registerPushToken(TOKEN_1);
    expect(notifications.addPushTokenListener).toHaveBeenCalledTimes(1);
  });
});

describe('logout', () => {
  it('a released token is forgotten: the next login with a new token deletes nothing', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await releasePushRegistration();
    await __pushRegistrationIdleForTests();
    expect(deleted()).toEqual([TOKEN_1]);
    expect(remembered()).toEqual([]);

    await restartApp();
    signIn();
    await registerPushToken(TOKEN_2);
    expect(fakeHttp.delete).not.toHaveBeenCalled();
  });

  it('a logout the backend never heard of is made good at the next login, if the token changed', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    fakeHttp.delete.mockRejectedValue(new Error('Network Error'));
    await releasePushRegistration();
    await __pushRegistrationIdleForTests();
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_1]);

    await restartApp();
    signIn();
    await registerPushToken(TOKEN_2);
    expect(deleted()).toEqual([TOKEN_1]);
  });

  it('both slots released together are both forgotten', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await registerPushToken(VOIP, { tokenType: 'apns-voip' });
    expect(remembered()).toHaveLength(2);

    await releasePushRegistration();
    await __pushRegistrationIdleForTests();
    expect(remembered()).toEqual([]);
  });

  it('unregisterPushToken forgets the token as well', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    await expect(unregisterPushToken()).resolves.toBe('unregistered');
    await __pushRegistrationIdleForTests();
    expect(remembered()).toEqual([]);
  });
});

describe('a token the OS replaces while the app runs', () => {
  it('is registered at once and the old one released, for a host that only implements getPushTokens', async () => {
    const getPushTokens = jest.fn().mockResolvedValue({ token: TOKEN_1 });
    signIn();
    store.dispatch(
      setConfig({
        appId: APP_ID,
        xmppSettings: { host: 'xmpp.example.com' },
        pushNotifications: { getPushTokens },
      } as any)
    );
    installPushTokenHook();
    await flush();
    expect(posted().map((p: any) => p.registrationToken)).toEqual([TOKEN_1]);

    notifications.__emit(TOKEN_2);
    await flush();
    await __pushRegistrationIdleForTests();

    expect(getPushTokens).toHaveBeenCalledTimes(1);
    expect(posted().map((p: any) => p.registrationToken)).toEqual([TOKEN_1, TOKEN_2]);
    expect(deleted()).toEqual([TOKEN_1]);
    expect(remembered().map((e) => e.token)).toEqual([TOKEN_2]);
  });

  it('keeps the device key of the token it replaces', async () => {
    signIn();
    await registerPushToken(TOKEN_1, { pushKey: 'k'.repeat(43) + '=' });
    notifications.__emit(TOKEN_2);
    await flush();
    expect(posted()[1].pushKey).toBe('k'.repeat(43) + '=');
  });

  it('the same token again changes nothing', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    notifications.__emit(TOKEN_1);
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    expect(fakeHttp.delete).not.toHaveBeenCalled();
  });

  it('a native token never replaces a token of another kind (Expo, Firebase on iOS)', async () => {
    signIn();
    await registerPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]');
    notifications.__emit(TOKEN_2);
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);

    await restartApp();
    signIn();
    await registerPushToken('dGVzdA:APA91bF-fcm-registration-token');
    notifications.__emit(TOKEN_2);
    await flush();
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('nothing is registered for a host that handed over no token', async () => {
    signIn();
    installPushTokenHook();
    notifications.__emit(TOKEN_1);
    await flush();
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('listens once, however many times the SDK is asked to watch', async () => {
    signIn();
    installPushTokenHook();
    await registerPushToken(TOKEN_1);
    installPushTokenHook();
    expect(notifications.addPushTokenListener).toHaveBeenCalledTimes(1);
  });
});

describe('getPushDiagnostics', () => {
  it('reports tails only, the ones the backend logs', async () => {
    signIn();
    await registerPushToken(TOKEN_1);
    const deviceId = (await getPushDeviceId())!;

    const diagnostics = await getPushDiagnostics();
    expect(diagnostics).toMatchObject({
      signedIn: true,
      disabled: false,
      deviceTail: deviceId.slice(-6),
      lastError: null,
      tokens: [{ tokenType: 'apns', tokenTail: 'b2e59a68607f', registered: true, encrypted: false }],
    });
    expect(typeof diagnostics.tokens[0].registeredAt).toBe('number');
    expect(JSON.stringify(diagnostics)).not.toContain(TOKEN_1);
    expect(JSON.stringify(diagnostics)).not.toContain(deviceId);
  });

  it('says so when the token is held but not on the backend, and why', async () => {
    signIn();
    fakeHttp.post.mockRejectedValue(refused('Forbidden', 403));
    await expect(registerPushToken(TOKEN_1)).rejects.toBeTruthy();

    const diagnostics = await getPushDiagnostics();
    expect(diagnostics.tokens[0]).toMatchObject({ registered: false, registeredAt: null });
    expect(diagnostics.lastError).toMatchObject({ status: 403 });

    fakeHttp.post.mockResolvedValue({ data: {} });
    store.dispatch(setPushEnabled(false));
    store.dispatch(setPushEnabled(true));
    await flush();
    expect((await getPushDiagnostics()).lastError).toBeNull();
  });
});
