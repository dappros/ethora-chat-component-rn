/**
 * Persistence through react-native-mmkv (mocked): plain JSON values under
 * the same keys, and a one-time migration of a cache that the previous
 * version wrote through crypto-js + AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';

const mockMmkvStore = new Map<string, string>();
jest.mock(
  'react-native-mmkv',
  () => ({
    MMKV: class {
      constructor(_options: { id: string; encryptionKey?: string }) {}
      getString(k: string) {
        return mockMmkvStore.get(k);
      }
      set(k: string, v: string) {
        mockMmkvStore.set(k, v);
      }
      delete(k: string) {
        mockMmkvStore.delete(k);
      }
      getAllKeys() {
        return [...mockMmkvStore.keys()];
      }
    },
  }),
  { virtual: true }
);

import chatSettingsReducer, { setUser } from '../src/roomStore/chatSettingsSlice';
import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import {
  PERSIST_KEYS,
  clearPersistedState,
  persistedRoomKey,
  persistenceMiddleware,
  readPersistedState,
} from '../src/roomStore/persistence';
import { __resetPersistBackend, getPersistBackend } from '../src/roomStore/persistBackend';
import { encryptForPersist } from '../src/helpers/persistCrypto';
import type { IRoom, User } from '../src/types/types';

const flushMicrotasks = async (turns = 40) => {
  for (let i = 0; i < turns; i++) {await Promise.resolve();}
};
const makeRoom = (jid: string): IRoom =>
  ({ id: jid, name: 'r', jid, title: 'r', usersCnt: 1, messages: [], isLoading: false, roomBg: '' } as IRoom);
const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) => g({ serializableCheck: false }).concat(persistenceMiddleware),
  });

beforeEach(async () => {
  mockMmkvStore.clear();
  await AsyncStorage.clear();
  __resetPersistBackend();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('persistence over MMKV', () => {
  it('picks MMKV, keys it from the secure store and writes plain JSON', async () => {
    const backend = await getPersistBackend();
    expect(backend.name).toBe('mmkv');

    const store = makeStore();
    store.dispatch(
      setUser({
        walletAddress: '0xabc',
        defaultWallet: { walletAddress: '0xabc' },
        firstName: 'A',
        token: 't',
      } as User)
    );
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));
    jest.advanceTimersByTime(1100);
    await flushMicrotasks();

    // Values are readable JSON (MMKV encrypts the file itself)…
    const raw = mockMmkvStore.get(persistedRoomKey('r@h'));
    expect(JSON.parse(raw!).jid).toBe('r@h');
    expect(JSON.parse(mockMmkvStore.get(PERSIST_KEYS.KEY_CHAT)!).user.token).toBe('');
    // …and nothing of the persisted state went to AsyncStorage (the
    // secure-store fallback keeps the user profile there in tests).
    expect(
      (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('@ethora/persist:'))
    ).toEqual([]);

    const out = await readPersistedState();
    expect(out.rooms?.rooms['r@h']).toBeDefined();
    expect(out.chat?.user.firstName).toBe('A');
  });

  it('migrates a crypto-js/AsyncStorage cache into MMKV on first read', async () => {
    // What the previous version left behind.
    await AsyncStorage.setItem(
      PERSIST_KEYS.KEY_ROOM_INDEX,
      await encryptForPersist(JSON.stringify({ jids: ['old@h'] }))
    );
    await AsyncStorage.setItem(
      persistedRoomKey('old@h'),
      await encryptForPersist(JSON.stringify(makeRoom('old@h')))
    );
    await AsyncStorage.setItem(
      PERSIST_KEYS.KEY_CHAT,
      await encryptForPersist(JSON.stringify({ user: { walletAddress: '0xold' } }))
    );

    const out = await readPersistedState();
    expect(out.rooms?.rooms['old@h']).toBeDefined();
    expect(out.chat?.user.walletAddress).toBe('0xold');

    // The next write moves everything over and drops the old keys.
    const store = makeStore();
    store.dispatch(addRoom({ roomData: makeRoom('old@h') }));
    jest.advanceTimersByTime(1100);
    await flushMicrotasks(80);
    expect(mockMmkvStore.has(persistedRoomKey('old@h'))).toBe(true);
    expect(mockMmkvStore.has(PERSIST_KEYS.KEY_CHAT)).toBe(true);
    expect(
      (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('@ethora/persist:'))
    ).toEqual([]);

    const again = await readPersistedState();
    expect(again.rooms?.rooms['old@h']).toBeDefined();
  });

  it('clearPersistedState wipes MMKV and any AsyncStorage leftovers', async () => {
    mockMmkvStore.set(persistedRoomKey('r@h'), '{}');
    mockMmkvStore.set(PERSIST_KEYS.KEY_ROOM_INDEX, '{"jids":["r@h"]}');
    await AsyncStorage.setItem(PERSIST_KEYS.KEY_ROOMS, 'x');
    await AsyncStorage.setItem('unrelated', 'keep');
    await clearPersistedState();
    expect(mockMmkvStore.size).toBe(0);
    expect(await AsyncStorage.getAllKeys()).toEqual(['unrelated']);
  });
});
