/**
 * ensureScopedChatCache — purges persisted user / store / REST cache /
 * xmpp client when the app-scope (appId + baseUrl) changes between
 * mounts.
 *
 * Uses real AsyncStorage + real redux (lazy store factory) so the
 * scope record round-trips through the same path production uses.
 * Mocks the network-side dependencies (clearRoomsRestCache,
 * clearPersistedState, clientRegistry).
 */

// Lazy-build the redux store inside the factory (jest.mock hoists).
jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const roomsReducer = require('../src/roomStore/roomsSlice').default;
  const store = configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });
  return { __esModule: true, store };
});

jest.mock('../src/networking/api-requests/rooms.api', () => ({
  clearRoomsRestCache: jest.fn(),
}));
jest.mock('../src/roomStore/persistence', () => ({
  clearPersistedState: jest.fn(async () => undefined),
}));

// clientRegistry: capture getGlobalXmppClient + setGlobalXmppClient.
jest.mock('../src/utils/clientRegistry', () => {
  let current: any = null;
  return {
    __esModule: true,
    getGlobalXmppClient: () => current,
    setGlobalXmppClient: (c: any) => {
      current = c;
    },
    __setForTest: (c: any) => {
      current = c;
    },
  };
});

import { ensureScopedChatCache } from '../src/helpers/ensureScopedChatCache';
import { store } from '../src/roomStore';
import { setUser, setConfig } from '../src/roomStore/chatSettingsSlice';
import { clearRoomsRestCache } from '../src/networking/api-requests/rooms.api';
import { clearPersistedState } from '../src/roomStore/persistence';
const clientRegistry = jest.requireMock('../src/utils/clientRegistry') as any;
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCOPE_KEY = '@ethora/chat-component-scope';
const USER_KEY = '@ethora/chat-component-user';

beforeEach(async () => {
  await AsyncStorage.clear();
  (clearRoomsRestCache as jest.Mock).mockClear();
  (clearPersistedState as jest.Mock).mockClear();
  clientRegistry.__setForTest(null);
  store.dispatch({ type: 'chat/logout' });
  store.dispatch({ type: 'roomMessages/setLogoutState' });
});

describe('ensureScopedChatCache', () => {
  it('first call writes the scope record and does NOT purge anything', async () => {
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'https://a.test/v1' } as any);
    const raw = await AsyncStorage.getItem(SCOPE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({
      appId: 'app-1',
      baseUrl: 'https://a.test/v1',
    });
    expect(clearRoomsRestCache).not.toHaveBeenCalled();
    expect(clearPersistedState).not.toHaveBeenCalled();
  });

  it('same-scope second call is a no-op', async () => {
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'https://a.test/v1' } as any);
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'https://a.test/v1' } as any);
    expect(clearRoomsRestCache).not.toHaveBeenCalled();
    expect(clearPersistedState).not.toHaveBeenCalled();
  });

  it('appId change purges REST cache, persisted state, user, and dispatches logout', async () => {
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'u' } as any);
    // Seed: a logged-in user + a persisted user record.
    store.dispatch(setUser({ _id: 'u1', email: 'x@y.com' } as any));
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ _id: 'u1' }));

    await ensureScopedChatCache({ appId: 'app-2', baseUrl: 'u' } as any);

    expect(clearRoomsRestCache).toHaveBeenCalledTimes(1);
    expect(clearPersistedState).toHaveBeenCalledTimes(1);
    // User slice was reset (logout).
    expect(store.getState().chatSettingStore.user._id).toBe('');
    // Persisted user record was removed.
    expect(await AsyncStorage.getItem(USER_KEY)).toBeNull();
    // The new scope was written.
    const raw = await AsyncStorage.getItem(SCOPE_KEY);
    expect(JSON.parse(raw!).appId).toBe('app-2');
  });

  it('baseUrl change also triggers purge', async () => {
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'https://a.test/v1' } as any);
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'https://b.test/v1' } as any);
    expect(clearRoomsRestCache).toHaveBeenCalledTimes(1);
    expect(clearPersistedState).toHaveBeenCalledTimes(1);
  });

  it('disconnects the global xmpp client (suppressReconnect=true) on scope change', async () => {
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'u' } as any);
    const disconnect = jest.fn(async () => undefined);
    clientRegistry.__setForTest({ disconnect });
    await ensureScopedChatCache({ appId: 'app-2', baseUrl: 'u' } as any);
    expect(disconnect).toHaveBeenCalledWith({ suppressReconnect: true });
  });

  it('is a no-op when config has neither appId nor baseUrl', async () => {
    await ensureScopedChatCache({} as any);
    await ensureScopedChatCache(undefined);
    expect(await AsyncStorage.getItem(SCOPE_KEY)).toBeNull();
    expect(clearRoomsRestCache).not.toHaveBeenCalled();
  });

  it('swallows a disconnect() throw without breaking the purge sequence', async () => {
    await ensureScopedChatCache({ appId: 'app-1', baseUrl: 'u' } as any);
    clientRegistry.__setForTest({
      disconnect: jest.fn(() => {
        throw new Error('disconnect failed');
      }),
    });
    await ensureScopedChatCache({ appId: 'app-2', baseUrl: 'u' } as any);
    expect(clearRoomsRestCache).toHaveBeenCalledTimes(1);
    expect(clearPersistedState).toHaveBeenCalledTimes(1);
  });
});
