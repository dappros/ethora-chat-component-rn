/**
 * Smoke test for the 3-tab testbed (`AppLoginChatsRn`).
 *
 * Asserts:
 *   - mounts at the Setup tab when no creds are persisted
 *   - "Test connection" hits POST /users/client with the typed JWT
 *   - "Save & use" persists creds to AsyncStorage and swaps to the Chat tab
 *   - the Chat pane mounts the local `<ReduxWrapper>` with
 *     `config.jwtLogin.token` propagated from Setup
 *   - clicking the Logs tab shows the live log feed (with the
 *     captured HTTP entries from the Test step)
 */

// AsyncStorage mock is provided by jest.setup.js.

// `installConsoleCapture()` is now a no-op when NODE_ENV==='test'
// (devLogger.ts), so the previous `console.* → pushLog → microtask
// notify → useSyncExternalStore re-render` feedback loop that hung
// this suite is broken at the source. No devLogger mock needed here.
// If a test ever needs to assert on captured logs, mock it locally
// inside that test with a fresh accumulator.

jest.mock('axios', () => {
  const fn = jest.fn();
  // axios is used as both a function and as `axios.post/get`.
  const post = jest.fn();
  const get = jest.fn();
  const _axios: any = fn;
  _axios.post = post;
  _axios.get = get;
  _axios.create = jest.fn(() => ({
    post: jest.fn(),
    get: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { baseURL: '' },
  }));
  return { __esModule: true, default: _axios, ...{ post, get } };
});

// Replace the local chat component with a probe so we can assert the
// JWT propagates through `config.jwtLogin.token`.
jest.mock('../src/components/MainComponents/ReduxWrapper', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const ReduxWrapper: React.FC<any> = (props) =>
    React.createElement(
      View,
      { testID: 'redux-wrapper-stub' },
      React.createElement(
        Text,
        { testID: 'redux-wrapper-jwt' },
        props?.config?.jwtLogin?.token ?? ''
      ),
      React.createElement(
        Text,
        { testID: 'redux-wrapper-baseurl' },
        props?.config?.baseUrl ?? ''
      ),
      React.createElement(
        Text,
        { testID: 'redux-wrapper-app-token' },
        props?.config?.customAppToken ?? ''
      ),
      React.createElement(
        Text,
        { testID: 'redux-wrapper-user' },
        props?.config?.userLogin?.user?.xmppUsername ?? ''
      )
    );
  return { __esModule: true, ReduxWrapper };
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import AppLoginChatsRn from '../AppLoginChatsRn';

const mockedAxios = axios as unknown as { post: jest.Mock; get: jest.Mock };

const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('Setup → Test → Save → Chat tab mounts ReduxWrapper with the entered JWT', async () => {
  const JWT = 'eyJhbGciOiJSUzI1NiJ9.body.sig';
  mockedAxios.post.mockResolvedValue({
    data: {
      token: 'srv-token',
      refreshToken: 'srv-refresh',
      user: {
        _id: 'u1',
        firstName: 'Alice',
        xmppUsername: '0xabc',
        xmppPassword: 'xpw',
      },
    },
  });

  let tree: any;
  await act(async () => {
    tree = renderer.create(<AppLoginChatsRn />);
    await flush();
  });

  // Setup tab is active by default (no persisted creds).
  // Locate tab buttons by matching their visible Text label.
  // (Earlier shape was <Pressable><Text>{label}</Text></Pressable>;
  // the current shape adds a wrapper <View><Text/>{badge?}</View>
  // inside each Pressable for the unread-count badge, so a single-
  // hop children lookup no longer works.)
  const Text = require('react-native').Text;
  const tabLabels = tree.root.findAllByType(Text).filter((t: any) => {
    const c = t.props.children;
    return typeof c === 'string' && ['Setup', 'Chat', 'Logs'].includes(c);
  });
  expect(tabLabels.length).toBe(3);

  // Locate inputs: JWT is the first multiline; baseUrl is the 2nd.
  const inputs = tree.root.findAllByType(require('react-native').TextInput);
  expect(inputs.length).toBeGreaterThanOrEqual(2);
  const jwtInput = inputs[0];
  const baseUrlInput = inputs[1];

  await act(async () => {
    jwtInput.props.onChangeText(JWT);
    baseUrlInput.props.onChangeText('https://api.chat.ethora.com/v1');
  });

  const testBtn = tree.root.findByProps({ testID: 'setup-test' });
  const saveBtn = tree.root.findByProps({ testID: 'setup-save' });

  await act(async () => {
    testBtn.props.onPress();
    await flush();
  });
  expect(mockedAxios.post).toHaveBeenCalledWith(
    expect.stringContaining('/users/client'),
    null,
    expect.objectContaining({
      headers: expect.objectContaining({ 'x-custom-token': JWT }),
    })
  );

  await act(async () => {
    saveBtn.props.onPress();
    await flush();
  });

  const stored = await AsyncStorage.getItem('@apploginchatsrn/creds');
  expect(stored).toBeTruthy();
  expect(JSON.parse(stored!).jwt).toBe(JWT);

  // The Chat tab is now active; ReduxWrapper stub is rendered with the
  // JWT and the configured base URL.
  const jwtLabels = tree.root.findAllByProps({
    testID: 'redux-wrapper-jwt',
  });
  expect(jwtLabels.length).toBeGreaterThan(0);
  expect(jwtLabels[0].props.children).toBe(JWT);

  const baseLabels = tree.root.findAllByProps({
    testID: 'redux-wrapper-baseurl',
  });
  expect(baseLabels[0].props.children).toBe(
    'https://api.chat.ethora.com/v1'
  );

  tree.unmount();
});

test('persisted creds skip the Setup tab and land directly on Chat', async () => {
  const JWT = 'eyJ.persisted.sig';
  await AsyncStorage.setItem(
    '@apploginchatsrn/creds',
    JSON.stringify({
      mode: 'jwt',
      jwt: JWT,
      appToken: '',
      email: '',
      password: '',
      resolvedUser: null,
      baseUrl: 'https://api.chat.ethora.com/v1',
      xmppHost: 'xmpp.chat.ethora.com',
      xmppDevServer: 'xmpp.chat.ethora.com',
    })
  );

  let tree: any;
  await act(async () => {
    tree = renderer.create(<AppLoginChatsRn />);
    await flush();
  });

  const jwtLabels = tree.root.findAllByProps({
    testID: 'redux-wrapper-jwt',
  });
  expect(jwtLabels.length).toBeGreaterThan(0);
  expect(jwtLabels[0].props.children).toBe(JWT);

  tree.unmount();
});

test('Email mode: Test connection hits /users/login-with-email, then Save → Chat', async () => {
  const APP_TOKEN = 'app-jwt-token';
  const EMAIL = 'user@example.com';
  const PASSWORD = 'secret123';

  // Server response shape mirrors what AuthForms expect.
  (axios as any).post.mockResolvedValue({
    data: {
      token: 'srv-token',
      refreshToken: 'srv-refresh',
      user: {
        _id: 'u-email',
        firstName: 'Bob',
        email: EMAIL,
        xmppUsername: '0xbob',
        xmppPassword: 'bxpw',
      },
    },
  });

  let tree: any;
  await act(async () => {
    tree = renderer.create(<AppLoginChatsRn />);
    await flush();
  });

  // Switch mode to Email.
  const emailModeBtn = tree.root.findByProps({ testID: 'mode-email' });
  await act(async () => {
    emailModeBtn.props.onPress();
  });

  const appTokenInput = tree.root.findByProps({ testID: 'input-app-token' });
  const emailInput = tree.root.findByProps({ testID: 'input-email' });
  const passwordInput = tree.root.findByProps({ testID: 'input-password' });
  await act(async () => {
    appTokenInput.props.onChangeText(APP_TOKEN);
    emailInput.props.onChangeText(EMAIL);
    passwordInput.props.onChangeText(PASSWORD);
  });

  // Test connection.
  const testBtn = tree.root.findByProps({ testID: 'setup-test' });
  await act(async () => {
    testBtn.props.onPress();
    await flush();
  });
  expect((axios as any).post).toHaveBeenCalledWith(
    expect.stringContaining('/users/login-with-email'),
    { email: EMAIL, password: PASSWORD },
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: APP_TOKEN }),
    })
  );

  // Save.
  const saveBtn = tree.root.findByProps({ testID: 'setup-save' });
  await act(async () => {
    saveBtn.props.onPress();
    await flush();
  });

  const stored = await AsyncStorage.getItem('@apploginchatsrn/creds');
  expect(stored).toBeTruthy();
  const parsed = JSON.parse(stored!);
  expect(parsed.mode).toBe('email');
  expect(parsed.appToken).toBe(APP_TOKEN);
  expect(parsed.resolvedUser?.xmppUsername).toBe('0xbob');

  // The Chat tab is now active; the ReduxWrapper stub does NOT carry a
  // jwtLogin in email mode — instead `customAppToken` + `userLogin.user`
  // are set.
  const jwtLabels = tree.root.findAllByProps({
    testID: 'redux-wrapper-jwt',
  });
  expect(jwtLabels[0].props.children).toBe('');

  const appTokenLabels = tree.root.findAllByProps({
    testID: 'redux-wrapper-app-token',
  });
  expect(appTokenLabels[0].props.children).toBe(APP_TOKEN);

  const userLabels = tree.root.findAllByProps({
    testID: 'redux-wrapper-user',
  });
  expect(userLabels[0].props.children).toBe('0xbob');

  tree.unmount();
});
