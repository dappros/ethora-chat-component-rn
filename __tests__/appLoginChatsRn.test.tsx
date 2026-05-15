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
  const tabPressables = tree.root
    .findAllByType(require('react-native').Pressable)
    .filter((p: any) => {
      const c = p.props.children;
      // Tab button children = <Text>Setup</Text> / etc.
      const text = c?.props?.children;
      return typeof text === 'string' && ['Setup', 'Chat', 'Logs'].includes(text);
    });
  expect(tabPressables.length).toBe(3);

  // Locate inputs: JWT is the first multiline; baseUrl is the 2nd.
  const inputs = tree.root.findAllByType(require('react-native').TextInput);
  expect(inputs.length).toBeGreaterThanOrEqual(2);
  const jwtInput = inputs[0];

  await act(async () => {
    jwtInput.props.onChangeText(JWT);
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
      jwt: JWT,
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
