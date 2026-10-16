import { fromBase64, toBase64 } from '../e2ee/crypto';
import { loadSecureStore, type SecureStoreOptions } from '../helpers/secureStoreRuntime';
import { pushLog } from '../utils/devLogger';
import {
  SEALED_BOX_PUBLIC_KEY_BYTES,
  SEALED_BOX_SECRET_KEY_BYTES,
  generateSealedBoxKeyPair,
  sealedBoxKeyId,
  sealedBoxPublicKeyOf,
} from './sealedBox';
import type { SealedPushKey } from './sealedPush';

// The device key for encrypted pushes: one X25519 pair per install, in the
// platform keychain / keystore through expo-secure-store. The public half
// goes to the push service with the token (`pushKey`); the secret half
// never leaves the device and is read by whoever renders a sealed push —
// the Android background task (`sealedPushTask.ts`, same process, same
// store) and the iOS notification service extension, which reads the
// keychain item directly (plugins/notification-service), so the item's
// attributes below are a contract with the Swift side:
//   service   `ethora.push` (expo-secure-store stores it as `ethora.push:no-auth`)
//   account   `ethora_push_secret_key`, UTF-8
//   value     base64 of the 32-byte secret key, UTF-8
//   group     the app's first keychain access group, which the config
//             plugin shares with the extension
// Readable after the first unlock so a push that arrives while the phone
// is locked still decrypts; this device only, so an iCloud keychain copy
// on another device is never a key for pushes that go to this one.

export const PUSH_KEY_KEYCHAIN_SERVICE = 'ethora.push';
export const PUSH_SECRET_KEY_ITEM = 'ethora_push_secret_key';
export const PUSH_PUBLIC_KEY_ITEM = 'ethora_push_public_key';

export interface PushKeyPair {
  /** Base64 of the raw 32-byte X25519 public key — the `pushKey` of the registration. */
  publicKey: string;
  /** The `pushKeyId` the service derives for it, for logs and the kid check. */
  keyId: string;
}

let warnedMissingStore = false;
const warnMissingStoreOnce = () => {
  if (warnedMissingStore) {return;}
  warnedMissingStore = true;
  pushLog(
    'warn',
    'push: expo-secure-store is not installed, so no device key for encrypted ' +
      'pushes can be kept; pushes stay in the clear.'
  );
};

const storeOptions = (): SecureStoreOptions | null => {
  const store = loadSecureStore();
  if (!store) {return null;}
  const accessible = store.accessible.afterFirstUnlockThisDeviceOnly;
  return {
    keychainService: PUSH_KEY_KEYCHAIN_SERVICE,
    ...(accessible !== undefined ? { keychainAccessible: accessible } : {}),
  };
};

const readItem = async (item: string): Promise<string | null> => {
  const store = loadSecureStore();
  const options = storeOptions();
  if (!store || !options) {return null;}
  try {
    return await store.getItemAsync(item, options);
  } catch (e) {
    pushLog('warn', `push: reading ${item} failed`, e);
    return null;
  }
};

const decodeKey = (raw: string | null, length: number): Uint8Array | null => {
  if (!raw) {return null;}
  try {
    const bytes = fromBase64(raw);
    return bytes.length === length ? bytes : null;
  } catch {
    return null;
  }
};

/**
 * The stored pair, or null when there is none (or it is unreadable).
 * The public key is re-derived from the secret, so the pair is consistent
 * even if only the secret item survived.
 */
export async function loadPushSecretKey(): Promise<SealedPushKey | null> {
  const secretKey = decodeKey(await readItem(PUSH_SECRET_KEY_ITEM), SEALED_BOX_SECRET_KEY_BYTES);
  if (!secretKey) {return null;}
  const stored = decodeKey(await readItem(PUSH_PUBLIC_KEY_ITEM), SEALED_BOX_PUBLIC_KEY_BYTES);
  return { publicKey: stored ?? sealedBoxPublicKeyOf(secretKey), secretKey };
}

const describe = (publicKey: Uint8Array): PushKeyPair => ({
  publicKey: toBase64(publicKey),
  keyId: sealedBoxKeyId(publicKey),
});

/** The public half of the stored pair, null when the device has no key. */
export async function getPushKeyPair(): Promise<PushKeyPair | null> {
  const key = await loadPushSecretKey();
  return key ? describe(key.publicKey) : null;
}

/**
 * Generate and store a new pair, replacing any existing one. Pushes sealed
 * for the old key stop opening at once, so re-register the token with the
 * new `publicKey` right after. Null when expo-secure-store is missing or
 * the keychain refused the write.
 */
export async function resetPushKeyPair(): Promise<PushKeyPair | null> {
  const store = loadSecureStore();
  const options = storeOptions();
  if (!store || !options) {
    warnMissingStoreOnce();
    return null;
  }
  const pair = generateSealedBoxKeyPair();
  try {
    await store.setItemAsync(PUSH_SECRET_KEY_ITEM, toBase64(pair.secretKey), options);
    await store.setItemAsync(PUSH_PUBLIC_KEY_ITEM, toBase64(pair.publicKey), options);
  } catch (e) {
    pushLog('warn', 'push: storing the device key failed', e);
    return null;
  }
  const check = await loadPushSecretKey();
  if (!check || toBase64(check.publicKey) !== toBase64(pair.publicKey)) {
    pushLog('warn', 'push: the device key was not kept');
    return null;
  }
  pushLog('rn', `push: new device key ${sealedBoxKeyId(pair.publicKey)}`);
  return describe(pair.publicKey);
}

/**
 * The device key for encrypted pushes, created on first call. Hand
 * `publicKey` to `registerPushToken` (or send it as `pushKey` yourself).
 */
export async function ensurePushKeyPair(): Promise<PushKeyPair | null> {
  const existing = await getPushKeyPair();
  return existing ?? resetPushKeyPair();
}

/** Remove the pair; the next `ensurePushKeyPair` creates a new one. */
export async function clearPushKeyPair(): Promise<void> {
  const store = loadSecureStore();
  const options = storeOptions();
  if (!store || !options) {return;}
  for (const item of [PUSH_SECRET_KEY_ITEM, PUSH_PUBLIC_KEY_ITEM]) {
    try {
      await store.deleteItemAsync(item, options);
    } catch {
      // Not there — nothing to remove.
    }
  }
}

/** Test seam only. */
export const __resetPushKeyStoreForTests = (): void => {
  warnedMissingStore = false;
};
