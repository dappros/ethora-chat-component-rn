import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSecureStore } from './secureStoreRuntime';
import { pushLog } from '../utils/devLogger';

// Fallback keys are prefixed and namespaced away from every other
// AsyncStorage key this SDK writes, so a host that never installs
// expo-secure-store can still be told apart from one that used to lack
// it and has since added it (see `secureSet`'s stale-fallback cleanup).
const FALLBACK_PREFIX = '@ethora/secure-fallback:';

let warnedFallback = false;
const warnFallbackOnce = () => {
  if (warnedFallback) {return;}
  warnedFallback = true;
  pushLog(
    'warn',
    'expo-secure-store is not installed — auth tokens, the XMPP ' +
      'password, and the message-history cipher key are falling back ' +
      'to plain AsyncStorage instead of the platform Keychain/Keystore. ' +
      'Add the optional peer dependency `expo-secure-store` to your app ' +
      'to store them securely.'
  );
};

/**
 * Small-value secure KV store: platform Keychain/Keystore via
 * expo-secure-store when the host has it installed, plain (but still
 * namespaced) AsyncStorage otherwise. NOT for bulk data — see
 * `persistCrypto.ts`'s size note on why message history goes through
 * AES instead of straight into this store.
 */
export async function secureGet(key: string): Promise<string | null> {
  const store = loadSecureStore();
  if (store) {
    try {
      return await store.getItemAsync(key);
    } catch (e) {
      pushLog('warn', `secureStore: getItemAsync(${key}) failed`, e);
      return null;
    }
  }
  warnFallbackOnce();
  return AsyncStorage.getItem(FALLBACK_PREFIX + key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  const store = loadSecureStore();
  if (store) {
    try {
      await store.setItemAsync(key, value);
      // Clean up a stale plaintext fallback copy from before this host
      // added expo-secure-store — otherwise it sits on disk forever.
      AsyncStorage.removeItem(FALLBACK_PREFIX + key).catch(() => undefined);
      return;
    } catch (e) {
      pushLog('warn', `secureStore: setItemAsync(${key}) failed`, e);
      return;
    }
  }
  warnFallbackOnce();
  await AsyncStorage.setItem(FALLBACK_PREFIX + key, value);
}

export async function secureRemove(key: string): Promise<void> {
  const store = loadSecureStore();
  if (store) {
    try {
      await store.deleteItemAsync(key);
    } catch {
      // Key may simply not exist — deleteItemAsync throwing here isn't
      // actionable either way.
    }
  }
  await AsyncStorage.removeItem(FALLBACK_PREFIX + key).catch(() => undefined);
}

/** Test seam only. */
export const __resetSecureKeyValueWarningForTests = (): void => {
  warnedFallback = false;
};
