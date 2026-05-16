/**
 * E2E smoke test for the bootstrap that consumers will use most:
 *
 *   <XmppProvider config={{ initBeforeLoad: true, jwtLogin: {...} }} />
 *   + setCurrentRoom(roomJID) from outside
 *
 * Verifies:
 *   - loginViaJwt is called with the configured JWT
 *   - setUser ends up in the chat redux slice
 *   - new XmppClient(...) was instantiated
 *   - waitForOnline + getRoomsStanza + getChatsPrivateStoreRequestStanza fire
 *   - providerBootstrapStatus transitions to 'ready'
 *   - dispatching setCurrentRoom({roomJID}) routes the single-room target
 */

// --- IMPORTANT: jest.mock calls must precede the imports they replace ---

jest.mock('@xmpp/client', () => ({
  __esModule: true,
  default: {
    client: jest.fn(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      send: jest.fn().mockResolvedValue(undefined),
      status: 'offline',
    })),
    xml: jest.fn(),
  },
  client: jest.fn(),
  xml: jest.fn(),
}));

const xmppClientInstances: any[] = [];
jest.mock('../src/networking/xmppClient', () => {
  // Lightweight stand-in: skips real network, exposes the methods the
  // provider chains. We collect every constructed instance for assertion.
  class FakeXmppClient {
    username: string;
    password: string;
    xmppSettings: any;
    status: 'online' = 'online';
    getRoomsStanza = jest.fn().mockResolvedValue(undefined);
    getChatsPrivateStoreRequestStanza = jest
      .fn()
      .mockResolvedValue(undefined);
    waitForOnline = jest.fn().mockResolvedValue(undefined);
    ensureConnected = jest.fn().mockResolvedValue(undefined);
    disconnect = jest.fn().mockResolvedValue(undefined);
    close = jest.fn().mockResolvedValue(undefined);
    setActiveRoomJid = jest.fn();
    scheduleReconnect = jest.fn();
    reconnect = jest.fn();
    onCriticalSend = jest.fn();
    constructor(username: string, password: string, settings?: any) {
      this.username = username;
      this.password = password;
      this.xmppSettings = settings;
      xmppClientInstances.push(this);
    }
  }
  return { __esModule: true, default: FakeXmppClient, XmppClient: FakeXmppClient };
});

jest.mock('../src/networking/api-requests/auth.api', () => ({
  loginViaJwt: jest.fn(),
}));

jest.mock('../src/networking/api-requests/rooms.api', () => ({
  getRooms: jest.fn().mockResolvedValue({ items: [] }),
  clearRoomsRestCache: jest.fn(),
}));

jest.mock('../src/helpers/historyPreloadScheduler', () => ({
  runHistoryPreloadScheduler: jest.fn().mockResolvedValue(undefined),
}));

// AsyncStorage already mocked in jest.setup.js.

import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  XmppProvider,
  useXmppClient,
} from '../src/context/xmppProvider';
import { setCurrentRoom } from '../src/roomStore/roomsSlice';
import { logout } from '../src/roomStore/chatSettingsSlice';

const { loginViaJwt } = jest.requireMock(
  '../src/networking/api-requests/auth.api'
);

const flushAsync = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

beforeEach(async () => {
  xmppClientInstances.length = 0;
  jest.clearAllMocks();
  store.dispatch(logout());
  // logoutMiddleware queues a setTimeout(0) that emits
  // 'ethora-xmpp-logout' for the XmppProvider listener. Flush it
  // BEFORE the test mounts the provider — otherwise the deferred
  // emit fires after the provider mounts and resets the status from
  // 'ready' back to 'idle', failing the bootstrap assertion.
  await new Promise((r) => setTimeout(r, 5));
});

const Probe: React.FC = () => {
  const ctx = useXmppClient();
  return (
    <Text testID="status">
      {ctx.providerBootstrapStatus}|{ctx.client ? 'client' : 'no-client'}
    </Text>
  );
};

test('jwtLogin + roomJID: provider bootstraps end-to-end', async () => {
  loginViaJwt.mockResolvedValue({
    walletAddress: '0xabc',
    defaultWallet: { walletAddress: '0xabc' },
    _id: 'u',
    firstName: 'A',
    lastName: 'B',
    appId: 'app',
    xmppPassword: 'xpw',
    xmppUsername: '0xabc',
    token: 't',
    refreshToken: 'r',
  });

  const config: any = {
    initBeforeLoad: true,
    appId: 'app',
    baseUrl: 'https://api.example.com/v1',
    customAppToken: 'app-token',
    jwtLogin: { enabled: true, token: 'jwt-abc' },
    xmppSettings: { devServer: 'host' },
  };

  let tree: any;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <XmppProvider config={config}>
          <Probe />
        </XmppProvider>
      </Provider>
    );
  });

  // Let all the bootstrap promises drain.
  await act(async () => {
    await flushAsync();
  });

  // 1. jwt login was issued with the configured token.
  expect(loginViaJwt).toHaveBeenCalledWith('jwt-abc');

  // 2. redux user got set from the jwt response.
  const reduxUser = store.getState().chatSettingStore.user;
  expect(reduxUser.walletAddress).toBe('0xabc');
  expect(reduxUser.xmppPassword).toBe('xpw');

  // 3. An XmppClient was instantiated with the user's xmpp creds + settings.
  expect(xmppClientInstances).toHaveLength(1);
  expect(xmppClientInstances[0].username).toBe('0xabc');
  expect(xmppClientInstances[0].password).toBe('xpw');
  expect(xmppClientInstances[0].xmppSettings).toMatchObject({
    devServer: 'host',
  });

  // 4. Provider drove the post-online chain.
  expect(xmppClientInstances[0].waitForOnline).toHaveBeenCalled();
  expect(xmppClientInstances[0].getRoomsStanza).toHaveBeenCalled();
  expect(
    xmppClientInstances[0].getChatsPrivateStoreRequestStanza
  ).toHaveBeenCalled();

  // 5. providerBootstrapStatus reached 'ready' and client is exposed.
  const status = tree.root.findByProps({ testID: 'status' }).props.children;
  expect(status.join ? status.join('') : String(status)).toMatch(
    /ready\|client/
  );

  // 6. Consumer can drive single-room mode via roomJID dispatch.
  act(() => {
    store.dispatch(setCurrentRoom({ roomJID: 'one-room@host' }));
  });
  expect(store.getState().rooms.activeRoomJID).toBe('one-room@host');

  tree.unmount();
});
