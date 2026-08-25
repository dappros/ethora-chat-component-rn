/**
 * Secure-at-rest storage: the Keychain/Keystore bridge, its KV wrapper
 * (fallback to AsyncStorage when the optional peer dep isn't installed),
 * the User split (secrets out of AsyncStorage), and the AES envelope
 * used for the bulk persisted message-history cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Control availability per test instead of relying on jest.setup.js's
// global expo-secure-store mock (which always looks "installed") — the
// fallback path is exactly what needs its own coverage here.
jest.mock('../src/helpers/secureStoreRuntime', () => ({
  __esModule: true,
  loadSecureStore: jest.fn(),
  isSecureStoreAvailable: jest.fn(),
}));

import { loadSecureStore } from '../src/helpers/secureStoreRuntime';
import {
  secureGet,
  secureSet,
  secureRemove,
  __resetSecureKeyValueWarningForTests,
} from '../src/helpers/secureKeyValue';
import { secureUserStorage } from '../src/helpers/secureUserStorage';
import { localStorageConstants } from '../src/helpers/constants/LOCAL_STORAGE';
import { asyncLocalStorage } from '../src/hooks/useLocalStorage';
import {
  encryptForPersist,
  decryptFromPersist,
  __resetPersistCryptoKeyForTests,
} from '../src/helpers/persistCrypto';
import { User } from '../src/types/types';

const loadSecureStoreMock = loadSecureStore as jest.Mock;

/** A fake Keychain/Keystore backed by an in-memory Map, matching the real API shape. */
function makeFakeSecureStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: jest.fn(async (key: string) =>
      map.has(key) ? (map.get(key) as string) : null
    ),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      map.delete(key);
    }),
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSecureKeyValueWarningForTests();
  __resetPersistCryptoKeyForTests();
  loadSecureStoreMock.mockReset();
});

describe('secureKeyValue — with expo-secure-store installed', () => {
  it('round-trips a value through the real Keychain/Keystore bridge', async () => {
    const fake = makeFakeSecureStore();
    loadSecureStoreMock.mockReturnValue(fake);

    await secureSet('k1', 'v1');
    expect(fake.setItemAsync).toHaveBeenCalledWith('k1', 'v1');
    expect(await secureGet('k1')).toBe('v1');

    await secureRemove('k1');
    expect(fake.deleteItemAsync).toHaveBeenCalledWith('k1');
    expect(await secureGet('k1')).toBeNull();
  });

  it('never touches AsyncStorage when SecureStore is available', async () => {
    const fake = makeFakeSecureStore();
    loadSecureStoreMock.mockReturnValue(fake);

    await secureSet('k2', 'v2');
    const asyncStorageKeys = await AsyncStorage.getAllKeys();
    expect(asyncStorageKeys).toHaveLength(0);
  });
});

describe('secureKeyValue — without expo-secure-store (host has not installed the optional peer dep)', () => {
  it('falls back to namespaced AsyncStorage', async () => {
    loadSecureStoreMock.mockReturnValue(null);

    await secureSet('k3', 'v3');
    expect(await secureGet('k3')).toBe('v3');
    // Namespaced, not sitting under the bare key.
    expect(await AsyncStorage.getItem('k3')).toBeNull();
    expect(
      await AsyncStorage.getItem('@ethora/secure-fallback:k3')
    ).toBe('v3');

    await secureRemove('k3');
    expect(await secureGet('k3')).toBeNull();
  });

  it('warns exactly once regardless of how many calls fall back', async () => {
    loadSecureStoreMock.mockReturnValue(null);
    const { pushLog } = require('../src/utils/devLogger');
    const spy = jest.spyOn(require('../src/utils/devLogger'), 'pushLog');

    await secureSet('a', '1');
    await secureGet('a');
    await secureSet('b', '2');

    const fallbackWarnings = spy.mock.calls.filter(([, msg]) =>
      String(msg).includes('expo-secure-store is not installed')
    );
    expect(fallbackWarnings).toHaveLength(1);
    spy.mockRestore();
    void pushLog;
  });

  it('migrates a value forward: SecureStore becoming available later stops using the fallback copy', async () => {
    loadSecureStoreMock.mockReturnValue(null);
    await secureSet('k4', 'fallback-value');

    const fake = makeFakeSecureStore();
    loadSecureStoreMock.mockReturnValue(fake);
    await secureSet('k4', 'secure-value');

    // The stale fallback copy is cleaned up once a real write succeeds.
    expect(await AsyncStorage.getItem('@ethora/secure-fallback:k4')).toBeNull();
    expect(await secureGet('k4')).toBe('secure-value');
  });
});

describe('secureUserStorage', () => {
  const baseUser = (extra: Partial<User> = {}): User =>
    ({
      walletAddress: '0xabc',
      defaultWallet: { walletAddress: '0xabc' },
      _id: 'u1',
      firstName: 'Test',
      lastName: 'User',
      appId: 'app',
      token: 'tok-secret',
      refreshToken: 'refresh-secret',
      xmppPassword: 'xmpp-secret',
      fileToken: 'ft-secret',
      xmppUsername: '0xabc',
      ...extra,
    } as User);

  it('round-trips the full user through get/set', async () => {
    loadSecureStoreMock.mockReturnValue(makeFakeSecureStore());
    await secureUserStorage().set(baseUser());

    const out = await secureUserStorage().get();
    expect(out?.token).toBe('tok-secret');
    expect(out?.refreshToken).toBe('refresh-secret');
    expect(out?.xmppPassword).toBe('xmpp-secret');
    expect(out?.fileToken).toBe('ft-secret');
    expect(out?.walletAddress).toBe('0xabc');
  });

  it('never writes the four secrets into the plain AsyncStorage profile blob — with SecureStore available', async () => {
    loadSecureStoreMock.mockReturnValue(makeFakeSecureStore());
    await secureUserStorage().set(baseUser());

    const rawProfile = await asyncLocalStorage<User>(
      localStorageConstants.ETHORA_USER
    ).get();
    expect(rawProfile?.token).toBe('');
    expect(rawProfile?.refreshToken).toBe('');
    expect(rawProfile?.xmppPassword).toBe('');
    expect(rawProfile?.fileToken).toBe('');
    // Non-secret fields are untouched.
    expect(rawProfile?.walletAddress).toBe('0xabc');
  });

  it('still keeps secrets out of the plain profile blob even without SecureStore installed (fallback is namespaced, not co-mingled)', async () => {
    loadSecureStoreMock.mockReturnValue(null);
    await secureUserStorage().set(baseUser());

    const rawProfile = await asyncLocalStorage<User>(
      localStorageConstants.ETHORA_USER
    ).get();
    expect(rawProfile?.token).toBe('');
    expect(rawProfile?.refreshToken).toBe('');

    // The fallback still round-trips correctly through the public API.
    const out = await secureUserStorage().get();
    expect(out?.token).toBe('tok-secret');
    expect(out?.refreshToken).toBe('refresh-secret');
  });

  it('remove() clears both the profile and every secret', async () => {
    const fake = makeFakeSecureStore();
    loadSecureStoreMock.mockReturnValue(fake);
    await secureUserStorage().set(baseUser());
    expect(fake.map.size).toBeGreaterThan(0);

    await secureUserStorage().remove();

    expect(fake.map.size).toBe(0);
    expect(await secureUserStorage().get()).toBeNull();
  });

  it('get() returns null when nothing was ever persisted', async () => {
    loadSecureStoreMock.mockReturnValue(makeFakeSecureStore());
    expect(await secureUserStorage().get()).toBeNull();
  });

  it('a missing/empty secret field round-trips as an empty string, not undefined-crashing', async () => {
    loadSecureStoreMock.mockReturnValue(makeFakeSecureStore());
    await secureUserStorage().set(baseUser({ fileToken: undefined }));

    const out = await secureUserStorage().get();
    expect(out?.fileToken).toBe('');
    expect(out?.token).toBe('tok-secret');
  });
});

describe('persistCrypto', () => {
  beforeEach(() => {
    loadSecureStoreMock.mockReturnValue(makeFakeSecureStore());
  });

  it('round-trips a JSON payload', async () => {
    const plaintext = JSON.stringify({ hello: 'world', n: 42 });
    const envelope = await encryptForPersist(plaintext);
    expect(await decryptFromPersist(envelope)).toBe(plaintext);
  });

  it('the stored envelope never contains the plaintext as a substring', async () => {
    const plaintext = JSON.stringify({ body: 'a very secret message body' });
    const envelope = await encryptForPersist(plaintext);
    expect(envelope).not.toContain('very secret message body');
  });

  it('two encryptions of the same plaintext produce different ciphertext (random IV)', async () => {
    const plaintext = JSON.stringify({ body: 'same message' });
    const a = await encryptForPersist(plaintext);
    const b = await encryptForPersist(plaintext);
    expect(a).not.toBe(b);
    expect(await decryptFromPersist(a)).toBe(plaintext);
    expect(await decryptFromPersist(b)).toBe(plaintext);
  });

  it('returns null (not a throw) for a pre-encryption plaintext blob', async () => {
    const legacyPlaintext = JSON.stringify({ user: { firstName: 'Legacy' } });
    await expect(decryptFromPersist(legacyPlaintext)).resolves.toBeNull();
  });

  it('returns null for garbage input', async () => {
    await expect(decryptFromPersist('not json at all {{{')).resolves.toBeNull();
    await expect(decryptFromPersist('{}')).resolves.toBeNull();
    await expect(
      decryptFromPersist(JSON.stringify({ v: 1, iv: 'x' }))
    ).resolves.toBeNull();
  });

  it('reuses one persisted key across calls instead of minting a new one each time', async () => {
    const fake = makeFakeSecureStore();
    loadSecureStoreMock.mockReturnValue(fake);

    await encryptForPersist('"a"');
    await encryptForPersist('"b"');

    expect(fake.setItemAsync).toHaveBeenCalledTimes(1); // only the key itself
  });

  it('a value encrypted under one key cannot be decrypted under a different one', async () => {
    const plaintext = '"secret"';
    const envelope = await encryptForPersist(plaintext);

    // Simulate a fresh install (module reloaded → new in-memory cache,
    // and a different underlying SecureStore-backed key).
    __resetPersistCryptoKeyForTests();
    loadSecureStoreMock.mockReturnValue(makeFakeSecureStore());

    expect(await decryptFromPersist(envelope)).toBeNull();
  });
});
