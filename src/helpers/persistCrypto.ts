import CryptoJS from 'crypto-js';
import { secureGet, secureSet } from './secureKeyValue';

// AES-256-CBC at rest for the bulk persisted state (message history +
// room list) that `roomStore/persistence.ts` writes to AsyncStorage.
// This is envelope encryption, not a SecureStore write of the payload
// itself: expo-secure-store has historically capped a single value's
// size on Android (chunking exists in newer releases, but the payload
// here is unbounded — up to MESSAGE_LIMIT messages per room, times
// every room), so only the small symmetric KEY goes through the
// platform Keychain/Keystore (`secureKeyValue.ts`); the ciphertext
// itself stays in plain AsyncStorage, unreadable without that key.
const CIPHER_KEY_STORE_KEY = 'ethora_history_cipher_key';
const ENVELOPE_VERSION = 1;
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 16; // one AES block

interface Envelope {
  v: number;
  iv: string; // base64
  ct: string; // base64 ciphertext
}

/**
 * `crypto-js`'s own `WordArray.random()` falls back to `Math.random()`
 * when it can't detect a browser `window.crypto` — not safe for key/IV
 * material. `react-native-get-random-values` (a REQUIRED peer
 * dependency, imported at the top of `main.ts`/`index.js` before
 * anything else in the SDK runs) polyfills the real thing onto
 * `global.crypto.getRandomValues` instead; source bytes from that and
 * hand them to crypto-js as a WordArray rather than trust its default.
 */
const randomWordArray = (byteLength: number): CryptoJS.lib.WordArray => {
  const bytes = new Uint8Array(byteLength);
  (global as any).crypto.getRandomValues(bytes);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] || 0) << 24) |
        ((bytes[i + 1] || 0) << 16) |
        ((bytes[i + 2] || 0) << 8) |
        (bytes[i + 3] || 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words, byteLength);
};

let cachedKeyPromise: Promise<CryptoJS.lib.WordArray> | null = null;

/**
 * One AES-256 key per install, generated on first use and persisted
 * through the SecureStore/Keychain bridge. Reused across logins on
 * purpose: the ciphertext it protects is deleted wholesale on logout
 * (`clearPersistedState`), so there is no cross-account data for a
 * stable key to expose — only the encrypted blob of whoever is
 * currently logged in ever exists on disk at a given time.
 */
const loadOrCreateKey = (): Promise<CryptoJS.lib.WordArray> => {
  if (cachedKeyPromise) {return cachedKeyPromise;}
  cachedKeyPromise = (async () => {
    const existing = await secureGet(CIPHER_KEY_STORE_KEY);
    if (existing) {
      return CryptoJS.enc.Base64.parse(existing);
    }
    const key = randomWordArray(KEY_BYTES);
    await secureSet(CIPHER_KEY_STORE_KEY, CryptoJS.enc.Base64.stringify(key));
    return key;
  })();
  return cachedKeyPromise;
};

/** Encrypt a JSON-serialisable payload for storage. Returns the string to persist. */
export async function encryptForPersist(plaintext: string): Promise<string> {
  const key = await loadOrCreateKey();
  const iv = randomWordArray(IV_BYTES);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    iv: CryptoJS.enc.Base64.stringify(iv),
    ct: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt a value previously written by `encryptForPersist`. Returns
 * null (never throws) for anything that isn't a valid envelope for the
 * current key — including a plaintext blob from a pre-encryption
 * install: the app just re-hydrates that room/history from the server,
 * same as any other empty-cache cold start.
 */
export async function decryptFromPersist(
  stored: string
): Promise<string | null> {
  try {
    const envelope = JSON.parse(stored) as Partial<Envelope>;
    if (
      !envelope ||
      envelope.v !== ENVELOPE_VERSION ||
      !envelope.iv ||
      !envelope.ct
    ) {
      return null;
    }
    const key = await loadOrCreateKey();
    const iv = CryptoJS.enc.Base64.parse(envelope.iv);
    const ciphertext = CryptoJS.enc.Base64.parse(envelope.ct);
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext } as CryptoJS.lib.CipherParams,
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    return plaintext || null;
  } catch {
    return null;
  }
}

/** Test seam only. */
export const __resetPersistCryptoKeyForTests = (): void => {
  cachedKeyPromise = null;
};
