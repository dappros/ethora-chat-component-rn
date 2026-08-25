/** persistence middleware — debounced write, sanitization, rehydrate. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer, {
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import {
  PERSIST_KEYS,
  clearPersistedState,
  persistenceMiddleware,
  readPersistedState,
} from '../src/roomStore/persistence';
import { decryptFromPersist } from '../src/helpers/persistCrypto';
import type { IRoom, User } from '../src/types/types';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

// The at-rest value is an AES envelope, not the plain JSON the middleware
// serialized — decrypt before parsing so content assertions still read
// the real payload. `flushMicrotasks` drains a deeper async chain than a
// bare AsyncStorage write: encrypting now awaits the SecureStore-backed
// cipher key (secureGet, and on first use secureSet) before the ciphertext
// is even computed, on top of the multiSet itself.
async function readDecrypted(key: string): Promise<any> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {return null;}
  const plain = await decryptFromPersist(raw);
  return plain ? JSON.parse(plain) : null;
}

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

function makeUser(): User {
  return {
    walletAddress: '0xabc',
    description: '',
    token: 'secret-token',
    refreshToken: 'secret-refresh',
    defaultWallet: { walletAddress: '0xabc' },
    _id: 'u1',
    firstName: 'Test',
    lastName: 'User',
    appId: 'app',
    xmppPassword: 'secret-xmpp',
    xmppUsername: '0xabc',
  } as User;
}

function makeRoom(jid: string): IRoom {
  return {
    id: jid,
    name: 'r',
    jid,
    title: 'r',
    usersCnt: 1,
    messages: [],
    isLoading: false,
    roomBg: '',
  };
}

function makeStore() {
  return configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) =>
      g({ serializableCheck: false }).concat(persistenceMiddleware),
  });
}

describe('persistence — write', () => {
  it('debounces writes and persists user + rooms after timer flushes', async () => {
    const store = makeStore();
    store.dispatch(setUser(makeUser()));
    store.dispatch(addRoom({ roomData: makeRoom('r@h') }));

    // No write yet (debounced 200 ms).
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_CHAT)).toBeNull();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS)).toBeNull();

    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    const chatRaw = await AsyncStorage.getItem(PERSIST_KEYS.KEY_CHAT);
    const roomsRaw = await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS);
    expect(chatRaw).not.toBeNull();
    expect(roomsRaw).not.toBeNull();
    // The raw value is an opaque AES envelope, not the plaintext payload:
    // it parses as JSON (the envelope itself is JSON) but carries none of
    // the actual persisted fields directly.
    const rawEnvelope = JSON.parse(chatRaw!);
    expect(rawEnvelope.user).toBeUndefined();
    expect(rawEnvelope.ct).toEqual(expect.any(String));

    const persistedChat = await readDecrypted(PERSIST_KEYS.KEY_CHAT);
    expect(persistedChat.user.walletAddress).toBe('0xabc');
    // Secrets must be scrubbed before write.
    expect(persistedChat.user.token).toBe('');
    expect(persistedChat.user.refreshToken).toBe('');
    expect(persistedChat.user.xmppPassword).toBe('');

    const persistedRooms = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(persistedRooms.rooms['r@h']).toBeDefined();
  });

  it('drops malformed room keys + caps to 100 messages per room', async () => {
    const store = makeStore();
    // Build a room with 110 messages so the cap actually has to fire.
    const msgs = Array.from({ length: 110 }, (_, i) => ({
      id: String(i + 1),
      user: { id: 'u', name: 'u', token: '', refreshToken: '' } as any,
      date: `2026-05-15T10:00:0${i % 10}Z`,
      body: `m${i}`,
      roomJid: 'r@h',
    }));
    store.dispatch(
      addRoom({ roomData: { ...makeRoom('r@h'), messages: msgs } })
    );

    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    const persistedRooms = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    expect(persistedRooms.rooms['r@h'].messages).toHaveLength(100);
    // Keeps the most recent 100 — drops m0..m9, keeps m10..m109.
    expect(persistedRooms.rooms['r@h'].messages[0].body).toBe('m10');
    expect(persistedRooms.rooms['r@h'].messages[99].body).toBe('m109');
  });
});

describe('persistence — read + clear', () => {
  it('readPersistedState returns null slices when storage empty', async () => {
    const out = await readPersistedState();
    expect(out.chat).toBeNull();
    expect(out.rooms).toBeNull();
  });

  it('clearPersistedState empties both keys', async () => {
    await AsyncStorage.setItem(PERSIST_KEYS.KEY_CHAT, JSON.stringify({ user: {} }));
    await AsyncStorage.setItem(PERSIST_KEYS.KEY_ROOMS, JSON.stringify({ rooms: {} }));
    await clearPersistedState();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_CHAT)).toBeNull();
    expect(await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS)).toBeNull();
  });

  it('treats a pre-encryption plaintext cache as a cold start, not a crash', async () => {
    // A user upgrading from a version that wrote plain JSON to this key.
    // `decryptFromPersist` sees a value that doesn't match the {v,iv,ct}
    // envelope shape and returns null, same as "nothing stored" — the
    // room/chat state just re-hydrates from the server instead of ever
    // being treated as (or crashing while parsed as) ciphertext.
    await AsyncStorage.setItem(
      PERSIST_KEYS.KEY_CHAT,
      JSON.stringify({ user: { firstName: 'Legacy' } })
    );
    await AsyncStorage.setItem(
      PERSIST_KEYS.KEY_ROOMS,
      JSON.stringify({ rooms: { 'old@h': {} } })
    );

    const out = await readPersistedState();
    expect(out.chat).toBeNull();
    expect(out.rooms).toBeNull();
  });
});
