import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureGetOrCreate } from '../helpers/secureKeyValue';
import {
  decryptFromPersist,
  encryptForPersist,
  isPersistKeyKept,
} from '../helpers/persistCrypto';
import { randomBytes, toHex } from './crypto';
import { createStore, type OmemoStore, type StringBackend } from './store';

const MMKV_INSTANCE_ID = 'ethora-omemo';
const MMKV_KEY_STORE_KEY = 'ethora_omemo_store_key';
const ASYNC_STORAGE_PREFIX = '@ethora/omemo:';

const createMmkvBackend = async (): Promise<StringBackend | null> => {
  let MMKV: any;
  try {
    MMKV = require('react-native-mmkv').MMKV;
  } catch {
    return null;
  }
  if (typeof MMKV !== 'function') {return null;}
  const key = await secureGetOrCreate(MMKV_KEY_STORE_KEY, () =>
    toHex(randomBytes(8))
  );
  if (!key) {throw new Error('e2ee: the device store key was not kept');}
  try {
    const storage = new MMKV({ id: MMKV_INSTANCE_ID, encryptionKey: key.value });
    if (key.created) {storage.clearAll();}
    return {
      getItem: async (key) => storage.getString(key) ?? null,
      setItem: async (key, value) => void storage.set(key, value),
      removeItem: async (key) => void storage.delete(key),
    };
  } catch (e) {
    console.warn('[e2ee] react-native-mmkv present but unusable, falling back', e);
    return null;
  }
};

const asyncStorageBackend: StringBackend = {
  getItem: async (key) => {
    const raw = await AsyncStorage.getItem(ASYNC_STORAGE_PREFIX + key);
    return raw ? decryptFromPersist(raw) : null;
  },
  setItem: async (key, value) =>
    AsyncStorage.setItem(ASYNC_STORAGE_PREFIX + key, await encryptForPersist(value)),
  removeItem: (key) => AsyncStorage.removeItem(ASYNC_STORAGE_PREFIX + key),
};

const createAsyncStorageBackend = async (): Promise<StringBackend> => {
  if (!(await isPersistKeyKept())) {
    throw new Error('e2ee: the storage cipher key was not kept');
  }
  return asyncStorageBackend;
};

let backendPromise: Promise<StringBackend> | null = null;

const getBackend = (): Promise<StringBackend> => {
  if (!backendPromise) {
    const opening = createMmkvBackend().then(
      (mmkv) => mmkv ?? createAsyncStorageBackend()
    );
    backendPromise = opening;
    // A refusal is not cached: the next start may find the store usable.
    opening.catch(() => {
      if (backendPromise === opening) {backendPromise = null;}
    });
  }
  return backendPromise;
};

export async function openDeviceStore(jid: string): Promise<OmemoStore> {
  return createStore(await getBackend(), jid);
}

export const __resetDeviceStoreForTests = (): void => {
  backendPromise = null;
};
