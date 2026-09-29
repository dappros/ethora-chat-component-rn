/**
 * A bootstrap that already succeeded must not be reported as failed later.
 *
 * The initBeforeLoad effect arms a 45 s budget timer every time it runs.
 * Its deps include fields that do NOT feed the bootstrap key - most
 * notably `userLogin.user.token`, which changes whenever the host hands in
 * a rotated token. Such a re-run finds the key already completed and
 * returns early ("already completed (same key) - skip") - but it used to
 * return WITHOUT clearing the budget it had just armed, so 45 s later the
 * timer flipped providerBootstrapStatus to 'failed' and the host saw a
 * "Connection error / Could not authenticate" modal over a perfectly
 * healthy, connected chat. Seen live on the simulator after a config
 * change; reproduced here deterministically.
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


const readStatus = (tree: any): string => {
  const c = tree.root.findByProps({ testID: 'status' }).props.children;
  return c.join ? c.join('') : String(c);
};

afterEach(() => {
  jest.useRealTimers();
});

test('a same-key re-run after a successful bootstrap never flips to failed', async () => {
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

  const base: any = {
    initBeforeLoad: true,
    appId: 'app',
    baseUrl: 'https://api.example.com/v1',
    customAppToken: 'app-token',
    jwtLogin: { enabled: true, token: 'jwt-abc' },
    xmppSettings: { devServer: 'host' },
  };

  const mount = (config: any) => (
    <Provider store={store}>
      <XmppProvider config={config}>
        <Probe />
      </XmppProvider>
    </Provider>
  );

  let tree: any;
  await act(async () => {
    tree = renderer.create(mount(base));
  });
  await act(async () => {
    await flushAsync();
  });
  expect(readStatus(tree)).toMatch(/ready\|client/);
  expect(loginViaJwt).toHaveBeenCalledTimes(1);

  // A dep of the bootstrap effect changes, but nothing in the bootstrap
  // KEY does (userLogin is disabled, so its user never enters the key).
  jest.useFakeTimers();
  await act(async () => {
    tree.update(
      mount({
        ...base,
        userLogin: { enabled: false, user: { token: 'rotated-token' } },
      })
    );
  });

  // Well past the 45 s budget.
  await act(async () => {
    jest.advanceTimersByTime(46000);
  });

  expect(readStatus(tree)).toMatch(/ready\|client/);
  // And it really was a skip, not a second login.
  expect(loginViaJwt).toHaveBeenCalledTimes(1);

  tree.unmount();
});
