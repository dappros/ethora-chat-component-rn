import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureGetOrCreate } from '../helpers/secureKeyValue';
import { encryptForPersist, decryptFromPersist } from '../helpers/persistCrypto';


export interface PersistBackend {
  name: 'mmkv' | 'async-storage';
  getMany(keys: string[]): Promise<(string | null)[]>;
  setMany(pairs: [string, string][]): Promise<void>;
  removeMany(keys: string[]): Promise<void>;
  allKeys(): Promise<string[]>;
}

const MMKV_INSTANCE_ID = 'ethora-chat-persist';
const MMKV_KEY_STORE_KEY = 'ethora_persist_mmkv_key';
const MMKV_KEY_LENGTH = 16;

const randomKey = (length: number): string => {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  (globalThis as any).crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {out += alphabet[bytes[i] % alphabet.length];}
  return out;
};


const createMmkvBackend = async (): Promise<PersistBackend | null> => {
  let MMKV: any;
  try {
    MMKV = require('react-native-mmkv').MMKV;
  } catch {
    return null;
  }
  if (typeof MMKV !== 'function') {return null;}
  try {
    const key = await secureGetOrCreate(MMKV_KEY_STORE_KEY, () =>
      randomKey(MMKV_KEY_LENGTH)
    );
    if (!key) {return null;}
    // Throws when the native module is missing from the binary.
    const storage = new MMKV({ id: MMKV_INSTANCE_ID, encryptionKey: key.value });
    if (key.created) {storage.clearAll();}
    return {
      name: 'mmkv',
      getMany: async (keys) => keys.map((k) => storage.getString(k) ?? null),
      setMany: async (pairs) => {
        for (const [k, v] of pairs) {storage.set(k, v);}
      },
      removeMany: async (keys) => {
        for (const k of keys) {storage.delete(k);}
      },
      allKeys: async () => storage.getAllKeys(),
    };
  } catch (e) {
    console.warn('[persist] react-native-mmkv present but unusable, falling back', e);
    return null;
  }
};

const asyncStorageBackend: PersistBackend = {
  name: 'async-storage',
  getMany: async (keys) => {
    const pairs = await AsyncStorage.multiGet(keys);
    return Promise.all(
      pairs.map(([, raw]) => (raw ? decryptFromPersist(raw) : Promise.resolve(null)))
    );
  },
  setMany: async (pairs) => {
    const encrypted = await Promise.all(
      pairs.map(async ([k, v]) => [k, await encryptForPersist(v)] as [string, string])
    );
    await AsyncStorage.multiSet(encrypted);
  },
  removeMany: (keys) => AsyncStorage.multiRemove(keys),
  allKeys: async () => [...(await AsyncStorage.getAllKeys())],
};

let backendPromise: Promise<PersistBackend> | null = null;

export const getPersistBackend = (): Promise<PersistBackend> => {
  if (!backendPromise) {
    backendPromise = createMmkvBackend().then((mmkv) => mmkv ?? asyncStorageBackend);
  }
  return backendPromise;
};

export const legacyAsyncStorageBackend = asyncStorageBackend;

export const __resetPersistBackend = () => {
  backendPromise = null;
};
