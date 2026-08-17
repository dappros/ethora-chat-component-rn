/**
 * authRefresh — the single rotation point (phase 1).
 *
 * The backend rotates refresh tokens and treats a re-presented token as
 * theft, so the behaviours pinned here are correctness-critical:
 *   - concurrent callers share ONE request (no parallel rotation)
 *   - the rotated token is persisted before the promise resolves
 *   - REFRESH_IN_PROGRESS retries instead of logging out
 *   - ALREADY_ROTATED adopts a newer stored token, else goes fatal
 *   - REUSE_DETECTED / NOT_FOUND are fatal
 *   - network errors are NOT fatal and leave the tokens alone
 */

jest.mock('axios', () => {
  const fakeHttp: any = jest.fn();
  fakeHttp.post = jest.fn();
  fakeHttp.get = jest.fn();
  fakeHttp.interceptors = {
    response: { use: jest.fn(), eject: jest.fn() },
    request: { use: jest.fn(), eject: jest.fn() },
  };
  fakeHttp.defaults = { baseURL: 'https://test' };
  return {
    __esModule: true,
    default: { create: jest.fn(() => fakeHttp) },
    __fakeHttp: fakeHttp,
  };
});

jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const store = configureStore({
    reducer: { chatSettingStore: chatSettingsReducer },
  });
  return { __esModule: true, store };
});

import axios from 'axios';
import { store } from '../src/roomStore';
import { setUser, setConfig } from '../src/roomStore/chatSettingsSlice';
import { asyncLocalStorage } from '../src/hooks/useLocalStorage';
import { localStorageConstants } from '../src/helpers/constants/LOCAL_STORAGE';
import {
  refreshAuthTokens,
  refreshAuthTokensQuietly,
  parseRefreshErrorCode,
  isRefreshFatalError,
  __resetAuthRefreshStateForTests,
} from '../src/networking/authRefresh';

const fakeHttp = (axios as any).__fakeHttp ?? (require('axios') as any).__fakeHttp;

const unauthorized = (code?: string) => ({
  response: { status: 401, data: code ? { code } : {}, headers: {} },
});

const seedUser = (refreshToken: string, token = 'access-old') => {
  store.dispatch(
    setUser({
      _id: 'u1',
      token,
      refreshToken,
      xmppPassword: 'pw',
      xmppUsername: 'user',
    } as any)
  );
};

beforeEach(async () => {
  __resetAuthRefreshStateForTests();
  jest.clearAllMocks();
  await asyncLocalStorage(localStorageConstants.ETHORA_USER).remove();
  store.dispatch(setConfig({ refreshTokens: { enabled: true } } as any));
  seedUser('refresh-1');
});

describe('happy path', () => {
  it('rotates, persists the new refreshToken, and resolves', async () => {
    fakeHttp.post.mockResolvedValueOnce({
      data: { token: 'access-2', refreshToken: 'refresh-2', wsToken: 'ws-2' },
    });

    const result = await refreshAuthTokens();

    expect(result).toEqual({
      token: 'access-2',
      refreshToken: 'refresh-2',
      wsToken: 'ws-2',
    });
    // Rotation reached both the store and durable storage before the
    // promise settled — losing it would look like reuse next launch.
    expect(store.getState().chatSettingStore.user.refreshToken).toBe(
      'refresh-2'
    );
    const stored: any = await asyncLocalStorage(
      localStorageConstants.ETHORA_USER
    ).get();
    expect(stored?.refreshToken).toBe('refresh-2');
  });

  it('sends the refresh token as the Authorization header', async () => {
    fakeHttp.post.mockResolvedValueOnce({
      data: { token: 'access-2', refreshToken: 'refresh-2' },
    });

    await refreshAuthTokens();

    expect(fakeHttp.post).toHaveBeenCalledWith(
      '/users/login/refresh',
      {},
      { headers: { Authorization: 'refresh-1' } }
    );
  });

  it('rejects a response that is missing either token', async () => {
    fakeHttp.post.mockResolvedValueOnce({ data: { token: 'access-2' } });

    await expect(refreshAuthTokens()).rejects.toThrow(
      /did not contain both tokens/
    );
  });
});

describe('concurrency', () => {
  it('collapses concurrent callers into a single request', async () => {
    // Deferred built up front: the module awaits storage before it ever
    // reaches http.post, so capturing `resolve` from inside the mock
    // implementation would still be a no-op when we call it below.
    let resolvePost: (value: any) => void = () => {};
    const pendingPost = new Promise((resolve) => {
      resolvePost = resolve;
    });
    fakeHttp.post.mockReturnValueOnce(pendingPost);

    const calls = [
      refreshAuthTokens(),
      refreshAuthTokens(),
      refreshAuthTokens(),
      refreshAuthTokens(),
      refreshAuthTokens(),
    ];

    resolvePost({ data: { token: 'access-2', refreshToken: 'refresh-2' } });
    const results = await Promise.all(calls);

    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
    results.forEach((r) => expect(r.refreshToken).toBe('refresh-2'));
  });

  it('starts a fresh request once the in-flight one has settled', async () => {
    fakeHttp.post
      .mockResolvedValueOnce({
        data: { token: 'access-2', refreshToken: 'refresh-2' },
      })
      .mockResolvedValueOnce({
        data: { token: 'access-3', refreshToken: 'refresh-3' },
      });

    await refreshAuthTokens();
    const second = await refreshAuthTokens();

    expect(fakeHttp.post).toHaveBeenCalledTimes(2);
    expect(second.refreshToken).toBe('refresh-3');
    // The second rotation presented the token the first one issued.
    expect(fakeHttp.post.mock.calls[1][2]).toEqual({
      headers: { Authorization: 'refresh-2' },
    });
  });
});

describe('error codes', () => {
  it('REFRESH_IN_PROGRESS: retries and succeeds without logging out', async () => {
    fakeHttp.post
      .mockRejectedValueOnce(unauthorized('REFRESH_IN_PROGRESS'))
      .mockRejectedValueOnce(unauthorized('REFRESH_IN_PROGRESS'))
      .mockResolvedValueOnce({
        data: { token: 'access-2', refreshToken: 'refresh-2' },
      });

    const result = await refreshAuthTokens();

    expect(fakeHttp.post).toHaveBeenCalledTimes(3);
    expect(result.refreshToken).toBe('refresh-2');
  });

  it('REFRESH_IN_PROGRESS: exhausting the budget is not fatal', async () => {
    fakeHttp.post.mockRejectedValue(unauthorized('REFRESH_IN_PROGRESS'));

    const error = await refreshAuthTokens().catch((e) => e);

    expect(fakeHttp.post).toHaveBeenCalledTimes(3);
    expect(isRefreshFatalError(error)).toBe(false);
    expect(store.getState().chatSettingStore.user.refreshToken).toBe(
      'refresh-1'
    );
  });

  it('ALREADY_ROTATED: adopts a newer token from storage', async () => {
    await asyncLocalStorage(localStorageConstants.ETHORA_USER).set({
      _id: 'u1',
      token: 'access-newer',
      refreshToken: 'refresh-newer',
    } as any);
    fakeHttp.post.mockRejectedValueOnce(
      unauthorized('REFRESH_TOKEN_ALREADY_ROTATED')
    );

    const result = await refreshAuthTokens();

    expect(result.refreshToken).toBe('refresh-newer');
    expect(store.getState().chatSettingStore.user.refreshToken).toBe(
      'refresh-newer'
    );
  });

  it('ALREADY_ROTATED: fatal when storage holds no newer token', async () => {
    fakeHttp.post.mockRejectedValueOnce(
      unauthorized('REFRESH_TOKEN_ALREADY_ROTATED')
    );

    const error = await refreshAuthTokens().catch((e) => e);

    expect(isRefreshFatalError(error)).toBe(true);
    expect(error.code).toBe('REFRESH_TOKEN_ALREADY_ROTATED');
  });

  it('REUSE_DETECTED is fatal', async () => {
    fakeHttp.post.mockRejectedValueOnce(
      unauthorized('REFRESH_TOKEN_REUSE_DETECTED')
    );

    const error = await refreshAuthTokens().catch((e) => e);

    expect(isRefreshFatalError(error)).toBe(true);
    expect(error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
  });

  it('NOT_FOUND is fatal', async () => {
    fakeHttp.post.mockRejectedValueOnce(
      unauthorized('REFRESH_TOKEN_NOT_FOUND')
    );

    const error = await refreshAuthTokens().catch((e) => e);

    expect(isRefreshFatalError(error)).toBe(true);
  });

  it('network failure is not fatal and leaves the tokens intact', async () => {
    fakeHttp.post.mockRejectedValueOnce(new Error('Network Error'));

    const error = await refreshAuthTokens().catch((e) => e);

    expect(isRefreshFatalError(error)).toBe(false);
    expect(store.getState().chatSettingStore.user.refreshToken).toBe(
      'refresh-1'
    );
  });

  it('a bare 401 without a code is not fatal', async () => {
    fakeHttp.post.mockRejectedValueOnce(unauthorized());

    const error = await refreshAuthTokens().catch((e) => e);

    expect(isRefreshFatalError(error)).toBe(false);
  });
});

describe('parseRefreshErrorCode', () => {
  it.each([
    ['data.code', { response: { status: 401, data: { code: 'REFRESH_IN_PROGRESS' } } }],
    [
      'data.error.code',
      {
        response: {
          status: 401,
          data: { error: { code: 'REFRESH_TOKEN_REUSE_DETECTED' } },
        },
      },
    ],
    [
      'data.errors[0].code',
      {
        response: {
          status: 401,
          data: { errors: [{ code: 'REFRESH_TOKEN_NOT_FOUND' }] },
        },
      },
    ],
    [
      'data.message',
      {
        response: {
          status: 401,
          data: { message: 'REFRESH_TOKEN_ALREADY_ROTATED' },
        },
      },
    ],
  ])('reads the code from %s', (_label, error) => {
    expect(parseRefreshErrorCode(error)).toBeTruthy();
  });

  it('returns null for a non-http error', () => {
    expect(parseRefreshErrorCode(new Error('boom'))).toBeNull();
  });
});

describe('missing token', () => {
  it('rejects without going fatal when there is nothing to rotate', async () => {
    seedUser('');

    const error = await refreshAuthTokens().catch((e) => e);

    expect(isRefreshFatalError(error)).toBe(false);
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });
});

describe('consumer refreshFunction', () => {
  it('is used instead of the built-in endpoint, and is deduped', async () => {
    const refreshFunction = jest.fn().mockResolvedValue({
      accessToken: 'host-access',
      refreshToken: 'host-refresh',
    });
    store.dispatch(
      setConfig({ refreshTokens: { enabled: true, refreshFunction } } as any)
    );

    const [a, b] = await Promise.all([
      refreshAuthTokens(),
      refreshAuthTokens(),
    ]);

    expect(refreshFunction).toHaveBeenCalledTimes(1);
    expect(fakeHttp.post).not.toHaveBeenCalled();
    expect(a.refreshToken).toBe('host-refresh');
    expect(b.refreshToken).toBe('host-refresh');
    expect(store.getState().chatSettingStore.user.token).toBe('host-access');
  });

  it('keeps the existing refreshToken when the host omits one', async () => {
    const refreshFunction = jest
      .fn()
      .mockResolvedValue({ accessToken: 'host-access' });
    store.dispatch(
      setConfig({ refreshTokens: { enabled: true, refreshFunction } } as any)
    );

    const result = await refreshAuthTokens();

    expect(result.refreshToken).toBe('refresh-1');
  });
});

describe('refreshAuthTokensQuietly', () => {
  it('swallows failures and returns null', async () => {
    fakeHttp.post.mockRejectedValueOnce(
      unauthorized('REFRESH_TOKEN_REUSE_DETECTED')
    );

    await expect(refreshAuthTokensQuietly()).resolves.toBeNull();
  });
});
