/**
 * The session ending on its own (the XMPP password is gone for good) and
 * the way back: the chat says so on its own screen and the host is told,
 * and "Retry" re-runs the bootstrap with the same config.
 */
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
    // 26.5.6 (bug #17): XmppClient supports a credentialsProvider for
    // JWT refresh on `not-authorized`. xmppProvider wires it up after
    // construction — the mock needs the setter so the bootstrap chain
    // doesn't trip on a missing method.
    setCredentialsProvider = jest.fn();
    // Provider also installs an on-online re-join callback (bug #21);
    // mock the setter so the bootstrap chain doesn't trip on a missing
    // method.
    setOnOnline = jest.fn();
    // Provider installs an auth-expired callback (idle stale-JWT loop fix);
    // mock the setter so the bootstrap chain doesn't trip on a missing
    // method.
    setOnAuthExpired = jest.fn();
    updateCredentials = jest.fn();
    authLost: (() => void) | null = null;
    setAuthLostHandler = (handler: (() => void) | null) => {
      this.authLost = handler;
    };
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


jest.mock('../src/hooks/useLogout', () => ({
  logoutService: { performLogout: jest.fn(async () => undefined) },
  useLogout: () => jest.fn(),
}));

import React from 'react';
import { DeviceEventEmitter, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  XmppProvider,
  useXmppClient,
  SESSION_LOST_EVENT,
} from '../src/context/xmppProvider';
import { logout } from '../src/roomStore/chatSettingsSlice';
import { logoutService } from '../src/hooks/useLogout';

const { loginViaJwt } = jest.requireMock('../src/networking/api-requests/auth.api');

const flushAsync = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const Probe: React.FC = () => {
  const ctx = useXmppClient();
  return <Text testID="status">{ctx.providerBootstrapStatus}</Text>;
};
const readStatus = (tree: any): string =>
  String(tree.root.findByProps({ testID: 'status' }).props.children);

const USER = {
  walletAddress: '0xabc', defaultWallet: { walletAddress: '0xabc' }, _id: 'u',
  firstName: 'A', lastName: 'B', appId: 'app', xmppPassword: 'xpw',
  xmppUsername: '0xabc', token: 't', refreshToken: 'r',
};

beforeEach(async () => {
  xmppClientInstances.length = 0;
  jest.clearAllMocks();
  store.dispatch(logout());
  await new Promise((r) => setTimeout(r, 5));
  loginViaJwt.mockResolvedValue(USER);
});

const mount = (config: any) => (
  <Provider store={store}>
    <XmppProvider config={config}>
      <Probe />
    </XmppProvider>
  </Provider>
);

const base = (extra: any = {}) => ({
  initBeforeLoad: true,
  appId: 'app',
  baseUrl: 'https://api.example.com/v1',
  customAppToken: 'app-token',
  jwtLogin: { enabled: true, token: 'jwt-abc' },
  xmppSettings: { devServer: 'host' },
  ...extra,
});

test('a lost password ends the session, tells the chat screen and the host', async () => {
  const onAfterLogout = jest.fn();
  const sessionLost = jest.fn();
  const sub = DeviceEventEmitter.addListener(SESSION_LOST_EVENT, sessionLost);
  let tree: any;
  await act(async () => {
    tree = renderer.create(mount(base({ logout: { enabled: true, onAfterLogout } })));
  });
  await act(async () => flushAsync());
  expect(readStatus(tree)).toBe('ready');
  const client = xmppClientInstances[0];
  expect(typeof client.authLost).toBe('function');

  await act(async () => {
    client.authLost();
    await flushAsync();
  });
  expect(logoutService.performLogout).toHaveBeenCalledTimes(1);
  expect(sessionLost).toHaveBeenCalledTimes(1);
  expect(onAfterLogout).toHaveBeenCalledTimes(1);
  sub.remove();
  await act(async () => tree.unmount());
});

test('"Retry" re-runs the bootstrap with the same config', async () => {
  let tree: any;
  await act(async () => {
    tree = renderer.create(mount(base()));
  });
  await act(async () => flushAsync());
  expect(readStatus(tree)).toBe('ready');
  expect(loginViaJwt).toHaveBeenCalledTimes(1);

  await act(async () => {
    DeviceEventEmitter.emit('ethora:retryBootstrap');
    await flushAsync();
  });
  expect(loginViaJwt).toHaveBeenCalledTimes(2);
  expect(readStatus(tree)).toBe('ready');
  await act(async () => tree.unmount());
});
