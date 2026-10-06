import { fromBase64, toBase64 } from './crypto';

export interface OmemoStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const BYTES_TAG = '$bytes';

export function encodeValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Uint8Array ? { [BYTES_TAG]: toBase64(item) } : item
  );
}

export function decodeValue<T>(text: string): T {
  return JSON.parse(text, (_key, item) =>
    item && typeof item === 'object' && typeof item[BYTES_TAG] === 'string'
      ? fromBase64(item[BYTES_TAG])
      : item
  ) as T;
}

export interface StringBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createStore(backend: StringBackend, jid: string): OmemoStore {
  const prefix = `${jid.toLowerCase()}|`;
  return {
    get: async <T>(key: string) => {
      const raw = await backend.getItem(prefix + key);
      return raw === null ? undefined : decodeValue<T>(raw);
    },
    set: (key, value) => backend.setItem(prefix + key, encodeValue(value)),
    delete: (key) => backend.removeItem(prefix + key),
  };
}

export function createMemoryBackend(): StringBackend {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
}

export function createMemoryStore(jid = 'memory'): OmemoStore {
  return createStore(createMemoryBackend(), jid);
}
