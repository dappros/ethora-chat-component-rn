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
import type { IRoom, User } from '../src/types/types';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

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
    // multiSet inside the middleware schedules a microtask — yield once.
    await Promise.resolve();
    await Promise.resolve();

    const chatRaw = await AsyncStorage.getItem(PERSIST_KEYS.KEY_CHAT);
    const roomsRaw = await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS);
    expect(chatRaw).not.toBeNull();
    expect(roomsRaw).not.toBeNull();

    const persistedChat = JSON.parse(chatRaw!);
    expect(persistedChat.user.walletAddress).toBe('0xabc');
    // Secrets must be scrubbed before write.
    expect(persistedChat.user.token).toBe('');
    expect(persistedChat.user.refreshToken).toBe('');
    expect(persistedChat.user.xmppPassword).toBe('');

    const persistedRooms = JSON.parse(roomsRaw!);
    expect(persistedRooms.rooms['r@h']).toBeDefined();
  });

  it('drops malformed room keys + caps to 50 messages per room', async () => {
    const store = makeStore();
    // Build a room with 55 messages.
    const msgs = Array.from({ length: 55 }, (_, i) => ({
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
    await Promise.resolve();
    await Promise.resolve();

    const persistedRooms = JSON.parse(
      (await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS))!
    );
    expect(persistedRooms.rooms['r@h'].messages).toHaveLength(50);
    // Keeps the most recent 50.
    expect(persistedRooms.rooms['r@h'].messages[0].body).toBe('m5');
    expect(persistedRooms.rooms['r@h'].messages[49].body).toBe('m54');
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
});
