/**
 * Encrypted pushes, the JS side: the envelope the push service sends, the
 * device key in expo-secure-store, the Android task that renders a sealed
 * push, and `pushKey` on the registration. The boxes here are sealed with
 * libsodium, as the service seals them.
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
  const chatSettingsReducer = require('../src/roomStore/chatSettingsSlice').default;
  const store = configureStore({ reducer: { chatSettingStore: chatSettingsReducer } });
  return { __esModule: true, store };
});

jest.mock(
  'expo-notifications',
  () => ({
    scheduleNotificationAsync: jest.fn(async () => 'id'),
    registerTaskAsync: jest.fn(async () => undefined),
  }),
  { virtual: true }
);
jest.mock(
  'expo-task-manager',
  () => {
    const tasks = new Map();
    return {
      __tasks: tasks,
      defineTask: jest.fn((name, fn) => {
        tasks.set(name, fn);
      }),
    };
  },
  { virtual: true }
);

import sodium from 'libsodium-wrappers';
import axios from 'axios';
import { AppState, Platform } from 'react-native';
import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { fromBase64 } from '../src/e2ee/crypto';
import {
  PUSH_KEY_KEYCHAIN_SERVICE,
  PUSH_SECRET_KEY_ITEM,
  __resetPushKeyStoreForTests,
  clearPushKeyPair,
  ensurePushKeyPair,
  getPushKeyPair,
  loadPushSecretKey,
  resetPushKeyPair,
} from '../src/push/pushKeyStore';
import {
  SEALED_PUSH_ALG,
  isSealedPush,
  openSealedPush,
  sealedPushEnvelopeOf,
} from '../src/push/sealedPush';
import {
  SEALED_PUSH_TASK,
  __resetSealedPushTaskForTests,
  presentSealedPush,
  registerSealedPushTask,
  sealedPushDataOf,
} from '../src/push/sealedPushTask';
import {
  __resetPushRegistrationForTests,
  registerPushToken,
} from '../src/services/pushRegistration';
import { PUSH_KEY_ALG, buildPushSubscriptionPayload } from '../src/networking/api-requests/push.api';

const http: any = (axios as any).__fakeHttp ?? (require("axios") as any).__fakeHttp;
const secureStore = require('expo-secure-store');
const { scheduleNotificationAsync, registerTaskAsync } = jest.requireMock('expo-notifications');
const definedTasks: Map<string, (body: any) => Promise<void>> =
  jest.requireMock('expo-task-manager').__tasks;

const CONTENT = {
  title: 'Alice',
  body: 'See you at 5',
  sender: 'Alice',
  senderJid: 'alice@xmpp.test',
  chat: 'Team',
  chatJid: 'team@conference.xmpp.test',
  msgID: '1728990000000',
  image: 'https://files.test/alice.png',
};

/** What the service sends for `publicKey`, the way `sealedEnvelope` builds it. */
const sealedPushFor = (publicKey: Uint8Array, content: object = CONTENT, kid?: string) => ({
  v: '1',
  alg: SEALED_PUSH_ALG,
  kid: kid ?? require('crypto').createHash('sha256').update(Buffer.from(publicKey)).digest('hex').slice(0, 16),
  jid: CONTENT.chatJid,
  msgID: CONTENT.msgID,
  userJid: 'bob@xmpp.test',
  enc: Buffer.from(sodium.crypto_box_seal(sodium.from_string(JSON.stringify(content)), publicKey)).toString('base64'),
});

beforeAll(async () => {
  await sodium.ready;
});

beforeEach(async () => {
  secureStore.__store.clear();
  secureStore.getItemAsync.mockClear();
  secureStore.setItemAsync.mockClear();
  scheduleNotificationAsync.mockClear();
  registerTaskAsync.mockClear();
  definedTasks.clear();
  http.post.mockReset();
  __resetPushKeyStoreForTests();
  __resetSealedPushTaskForTests();
  __resetPushRegistrationForTests();
  await clearPushKeyPair();
});

describe('device key', () => {
  it('creates one pair, keeps it across calls, and stores it under the push keychain service', async () => {
    const first = await ensurePushKeyPair();
    const second = await ensurePushKeyPair();
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fromBase64(first!.publicKey)).toHaveLength(32);
    expect(first!.keyId).toMatch(/^[0-9a-f]{16}$/);

    // The attributes the iOS extension reads the secret with.
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      PUSH_SECRET_KEY_ITEM,
      expect.any(String),
      expect.objectContaining({ keychainService: PUSH_KEY_KEYCHAIN_SERVICE })
    );
    const key = await loadPushSecretKey();
    expect(key && sodium.crypto_scalarmult_base(key.secretKey)).toEqual(fromBase64(first!.publicKey));
  });

  it('reset makes a different pair, clear removes it', async () => {
    const first = await ensurePushKeyPair();
    const next = await resetPushKeyPair();
    expect(next!.publicKey).not.toBe(first!.publicKey);
    expect((await getPushKeyPair())!.publicKey).toBe(next!.publicKey);
    await clearPushKeyPair();
    expect(await getPushKeyPair()).toBeNull();
  });
});

describe('opening a sealed push', () => {
  it('recognises the envelope and opens a box libsodium sealed for the device key', async () => {
    const pair = (await ensurePushKeyPair())!;
    const data = sealedPushFor(fromBase64(pair.publicKey));
    expect(isSealedPush(data)).toBe(true);
    expect(isSealedPush({ jid: 'x', msgID: '1' })).toBe(false);

    const result = openSealedPush(sealedPushEnvelopeOf(data)!, await loadPushSecretKey());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toEqual(CONTENT);
      expect(result.envelope.jid).toBe(CONTENT.chatJid);
    }
  });

  it('names every reason it cannot open', async () => {
    const pair = (await ensurePushKeyPair())!;
    const key = await loadPushSecretKey();
    const publicKey = fromBase64(pair.publicKey);
    const other = sodium.crypto_box_keypair();

    const noKey = openSealedPush(sealedPushEnvelopeOf(sealedPushFor(publicKey))!, null);
    expect(noKey).toMatchObject({ ok: false, reason: 'no-key' });

    const mismatch = openSealedPush(
      sealedPushEnvelopeOf(sealedPushFor(other.publicKey))!,
      key
    );
    expect(mismatch).toMatchObject({ ok: false, reason: 'key-mismatch' });

    const { enc: _enc, ...noEnc } = sealedPushFor(publicKey);
    expect(openSealedPush(sealedPushEnvelopeOf(noEnc)!, key)).toMatchObject({
      ok: false,
      reason: 'no-ciphertext',
    });

    // Sealed for another key but claiming our kid: a box that does not open.
    const forged = { ...sealedPushFor(other.publicKey), kid: pair.keyId };
    expect(openSealedPush(sealedPushEnvelopeOf(forged)!, key)).toMatchObject({
      ok: false,
      reason: 'bad-ciphertext',
    });

    const notJson = {
      ...sealedPushFor(publicKey),
      enc: Buffer.from(sodium.crypto_box_seal(sodium.from_string('plain text'), publicKey)).toString('base64'),
    };
    expect(openSealedPush(sealedPushEnvelopeOf(notJson)!, key)).toMatchObject({
      ok: false,
      reason: 'bad-content',
    });
  });
});

describe('Android task', () => {
  const asAndroid = () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  };
  const asIos = () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  };
  let originalOS: string;
  beforeEach(() => {
    originalOS = Platform.OS;
    asAndroid();
    (AppState as any).currentState = 'background';
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('finds the FCM data map wherever expo-notifications put it', () => {
    const map = { alg: SEALED_PUSH_ALG, jid: 'r@c', msgID: '1', enc: 'x' };
    expect(sealedPushDataOf({ notification: null, data: map })).toEqual(map);
    expect(sealedPushDataOf({ data: { dataString: JSON.stringify(map) } })).toEqual(map);
    expect(sealedPushDataOf({ data: { data: map } })).toEqual(map);
    expect(sealedPushDataOf({ data: { jid: 'r@c', msgID: '1' } })).toBeNull();
    expect(sealedPushDataOf(null)).toBeNull();
  });

  it('registers the task once, and the task shows the decrypted text as one notification per chat', async () => {
    expect(registerSealedPushTask({ channelId: 'messages' })).toBe(true);
    expect(registerSealedPushTask()).toBe(true);
    expect(registerTaskAsync).toHaveBeenCalledTimes(1);
    expect(registerTaskAsync).toHaveBeenCalledWith(SEALED_PUSH_TASK);

    const pair = (await ensurePushKeyPair())!;
    const data = sealedPushFor(fromBase64(pair.publicKey));
    await definedTasks.get(SEALED_PUSH_TASK)!({ data: { notification: null, data }, error: null });

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const request = scheduleNotificationAsync.mock.calls[0]![0] as any;
    expect(request.identifier).toBe(CONTENT.chatJid);
    expect(request.trigger).toEqual({ channelId: 'messages' });
    expect(request.content).toMatchObject({
      title: 'Alice',
      body: 'See you at 5',
      data: { jid: CONTENT.chatJid, msgID: CONTENT.msgID, userJid: 'bob@xmpp.test', sealed: true },
    });
  });

  it('shows the placeholder, never the ciphertext, when the box does not open', async () => {
    const other = sodium.crypto_box_keypair();
    await ensurePushKeyPair();
    const result = await presentSealedPush(sealedPushFor(other.publicKey), {
      placeholderTitle: 'Новое сообщение',
    });
    expect(result).toMatchObject({ ok: false, reason: 'key-mismatch' });
    const request = scheduleNotificationAsync.mock.calls[0]![0] as any;
    expect(request.content.title).toBe('Новое сообщение');
    expect(request.content.body).toBeUndefined();
    expect(request.content.data).not.toHaveProperty('enc');
    expect(JSON.stringify(request)).not.toContain(sealedPushFor(other.publicKey).enc.slice(0, 20));
    expect(request.trigger).toBeNull();
  });

  it('hands a shown push with an avatar to onMessageShown, and not one without', async () => {
    const pair = (await ensurePushKeyPair())!;
    const onMessageShown = jest.fn();
    await presentSealedPush(sealedPushFor(fromBase64(pair.publicKey)), {
      channelId: 'messages',
      onMessageShown,
    });
    expect(onMessageShown).toHaveBeenCalledTimes(1);
    expect(onMessageShown.mock.calls[0]![0]).toEqual({
      identifier: CONTENT.chatJid,
      channelId: 'messages',
      title: 'Alice',
      body: 'See you at 5',
      sender: 'Alice',
      senderJid: CONTENT.senderJid,
      chat: 'Team',
      chatJid: CONTENT.chatJid,
      image: CONTENT.image,
      reaction: false,
    });
    // Called after the notification was scheduled: it redraws that one.
    expect(scheduleNotificationAsync.mock.invocationCallOrder[0]).toBeLessThan(
      onMessageShown.mock.invocationCallOrder[0]!
    );

    // Avatar switched off on the service: nothing to redraw.
    onMessageShown.mockClear();
    await presentSealedPush(sealedPushFor(fromBase64(pair.publicKey), { ...CONTENT, image: '' }), {
      onMessageShown,
    });
    expect(onMessageShown).not.toHaveBeenCalled();

    // A failing host callback never fails the push.
    const failing = jest.fn(async () => {
      throw new Error('native module missing');
    });
    await expect(
      presentSealedPush(sealedPushFor(fromBase64(pair.publicKey)), { onMessageShown: failing })
    ).resolves.toMatchObject({ ok: true });
  });

  it('ignores plain pushes and a foreground app, and does nothing on iOS', async () => {
    registerSealedPushTask();
    const task = definedTasks.get(SEALED_PUSH_TASK)!;
    await task({ data: { data: { jid: 'r@c', msgID: '1' } }, error: null });
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();

    const pair = (await ensurePushKeyPair())!;
    (AppState as any).currentState = 'active';
    await task({ data: { data: sealedPushFor(fromBase64(pair.publicKey)) }, error: null });
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();

    __resetSealedPushTaskForTests();
    asIos();
    expect(registerSealedPushTask()).toBe(false);
  });
});

describe('registration with a device key', () => {
  beforeEach(() => {
    store.dispatch(setConfig({ appId: 'app-1' } as any));
    store.dispatch(setUser({ token: 'Bearer t', xmppUsername: 'bob', appId: 'app-1' } as any));
  });

  it('sends pushKey with the algorithm next to the token', async () => {
    http.post.mockResolvedValue({ data: {} });
    const pair = (await ensurePushKeyPair())!;
    await registerPushToken('f'.repeat(64), { tokenType: 'apns', pushKey: pair.publicKey });
    expect(http.post).toHaveBeenCalledWith(
      '/v1/push/subscription/app-1',
      expect.objectContaining({
        registrationToken: 'f'.repeat(64),
        tokenType: 'apns',
        pushKey: pair.publicKey,
        pushKeyAlg: PUSH_KEY_ALG,
      }),
      expect.anything()
    );
    expect(buildPushSubscriptionPayload('t', 'fcm')).not.toHaveProperty('pushKey');
    expect(buildPushSubscriptionPayload('t', 'fcm', 'k', 'id')).toMatchObject({
      pushKey: 'k',
      pushKeyAlg: PUSH_KEY_ALG,
      pushKeyId: 'id',
    });
  });

  it('never drops the key to get registered on a backend without encrypted pushes', async () => {
    http.post.mockRejectedValue({
      response: { status: 422, data: { error: '"pushKey" is not allowed' } },
    });
    await expect(
      registerPushToken('f'.repeat(64), { tokenType: 'apns', pushKey: 'AAAA' })
    ).rejects.toThrow(/does not support encrypted pushes/);
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('re-registers the same token when the key changes', async () => {
    http.post.mockResolvedValue({ data: {} });
    await registerPushToken('f'.repeat(64), { tokenType: 'apns', pushKey: 'AAAA' });
    await registerPushToken('f'.repeat(64), { tokenType: 'apns', pushKey: 'AAAA' });
    expect(http.post).toHaveBeenCalledTimes(1);
    await registerPushToken('f'.repeat(64), { tokenType: 'apns', pushKey: 'BBBB' });
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post.mock.calls[1]![1]).toMatchObject({ pushKey: 'BBBB' });
  });
});
