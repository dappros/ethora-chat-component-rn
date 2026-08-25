/**
 * Optional-dependency bridge for `expo-secure-store` — the Keychain
 * (iOS) / Keystore-backed EncryptedSharedPreferences (Android) API.
 *
 * Mirrors `components/VideoCalls/livekitRuntime.ts`: a plain top-level
 * `import ... from 'expo-secure-store'` is not allowed anywhere in the
 * SDK, since Metro resolves imports at bundle time and a host that
 * hasn't added this optional peer dependency would fail to build over
 * a feature it never opted into. Everything goes through
 * `loadSecureStore()`, which requires the module lazily and returns
 * null when it isn't installed — callers fall back to plain
 * AsyncStorage rather than crash (see `secureKeyValue.ts`).
 */

export interface SecureStoreRuntime {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

let cached: SecureStoreRuntime | null | undefined;

/**
 * Resolve the SecureStore runtime, or null when the optional native
 * package isn't installed in the host app. Result is memoised
 * (including the failure) so a missing dependency doesn't re-throw on
 * every read/write.
 */
export const loadSecureStore = (): SecureStoreRuntime | null => {
  if (cached !== undefined) {
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store');
    if (
      typeof mod?.getItemAsync !== 'function' ||
      typeof mod?.setItemAsync !== 'function' ||
      typeof mod?.deleteItemAsync !== 'function'
    ) {
      cached = null;
    } else {
      cached = {
        getItemAsync: mod.getItemAsync,
        setItemAsync: mod.setItemAsync,
        deleteItemAsync: mod.deleteItemAsync,
      };
    }
  } catch {
    cached = null;
  }

  return cached;
};

export const isSecureStoreAvailable = (): boolean => loadSecureStore() !== null;

/** Test seam only. */
export const __resetSecureStoreRuntimeForTests = (): void => {
  cached = undefined;
};
