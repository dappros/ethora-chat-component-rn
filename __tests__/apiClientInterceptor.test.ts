/**
 * apiClient — response interceptor + refresh() helper.
 *
 * Mocks `axios.create` so we control the http instance the module
 * receives, capture the interceptor handlers it registers, then
 * invoke them with synthetic error shapes to verify each branch.
 *
 * Pinned behaviours (after the round-10 source fixes):
 *   - refresh() resolves with the axios response on success and
 *     rejects on either the inner http.post rejection or a sync
 *     throw from the outer try.
 *   - Non-401 errors propagate as Promise.reject.
 *   - refreshTokens.enabled === false propagates the original error
 *     (no silent swallow).
 *   - refreshTokens.refreshFunction path: dispatches refreshTokens,
 *     stamps Authorization onto the original request, retries.
 *   - Built-in refresh path: queues subsequent 401s while refreshing,
 *     drains the queue with the new token, retries the original.
 *   - 401 on /users/login/refresh or /users/login short-circuits to
 *     reject (no recursion).
 */

// ---- Mocks (hoisted) -----------------------------------------------

// Build the fake http instance lazily inside the factory to avoid the
// "out-of-scope variable" hoist trap.
jest.mock('axios', () => {
  const fakeHttp: any = jest.fn();
  fakeHttp.post = jest.fn();
  fakeHttp.get = jest.fn();
  fakeHttp.put = jest.fn();
  fakeHttp.delete = jest.fn();
  fakeHttp.interceptors = {
    response: { use: jest.fn(), eject: jest.fn() },
    request: { use: jest.fn(), eject: jest.fn() },
  };
  fakeHttp.defaults = { baseURL: 'https://test/v1' };
  // axios.create returns the same instance every time so the apiClient
  // module's `http` and our captured fake are one and the same.
  return {
    __esModule: true,
    default: { create: jest.fn(() => fakeHttp) },
    __fakeHttp: fakeHttp,
  };
});

// Lazy redux store inside the factory — chatSettingsSlice covers
// setConfig (for refreshTokens.enabled / .refreshFunction) + setUser
// (for the refreshToken in refresh()).
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

// installAxiosCapture would attach dev-logger interceptors and bloat
// the captured interceptor list; stub it.
jest.mock('../src/utils/devLogger', () => ({
  installAxiosCapture: jest.fn(),
  pushLog: jest.fn(),
}));

import { store } from '../src/roomStore';
import {
  setUser,
  setConfig,
} from '../src/roomStore/chatSettingsSlice';

import {
  default as http,
  refresh,
  setBaseURL,
  getCurrentAppToken,
  getCurrentBaseURL,
} from '../src/networking/apiClient';

import {
  __resetAuthRefreshStateForTests,
} from '../src/networking/authRefresh';
import { asyncLocalStorage } from '../src/hooks/useLocalStorage';
import { localStorageConstants } from '../src/helpers/constants/LOCAL_STORAGE';

const fakeHttp = (jest.requireMock('axios') as any).__fakeHttp as any;

// Grab the error handler the module registered (last `use` call wins
// in case any other call ever sneaks in).
const interceptorOnError = () => {
  const calls = (fakeHttp.interceptors.response.use as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1] as (e: any) => Promise<any>;
};

beforeEach(async () => {
  fakeHttp.post.mockReset();
  fakeHttp.get.mockReset();
  fakeHttp.put.mockReset();
  fakeHttp.delete.mockReset();
  (fakeHttp as jest.Mock).mockReset();
  store.dispatch({ type: 'chat/logout' });
  // Drop any shared in-flight rotation left over from the previous case.
  __resetAuthRefreshStateForTests();
  await asyncLocalStorage(localStorageConstants.ETHORA_USER).remove();
});

// ---- refresh() ------------------------------------------------------

describe('refresh() — deprecated forwarder', () => {
  it('forwards to authRefresh and resolves with the rotated tokens', async () => {
    store.dispatch(setUser({ refreshToken: 'old-ref' } as any));
    fakeHttp.post.mockResolvedValueOnce({
      data: { token: 'new-tok', refreshToken: 'new-ref' },
    });
    const res = await refresh();
    expect(fakeHttp.post).toHaveBeenCalledWith(
      '/users/login/refresh',
      {},
      { headers: { Authorization: 'old-ref' } }
    );
    // No longer the axios envelope — the forwarder returns RefreshResult.
    expect(res.token).toBe('new-tok');
    expect(store.getState().chatSettingStore.user.token).toBe('new-tok');
    expect(store.getState().chatSettingStore.user.refreshToken).toBe('new-ref');
  });

  it('rejects when the refresh POST rejects', async () => {
    store.dispatch(setUser({ refreshToken: 'r' } as any));
    fakeHttp.post.mockRejectedValueOnce(new Error('401'));
    await expect(refresh()).rejects.toThrow('401');
  });

  it('does NOT log out on a transport-level failure', async () => {
    store.dispatch(setUser({ _id: 'u1', refreshToken: 'r' } as any));
    fakeHttp.post.mockImplementationOnce(() => {
      throw new Error('sync boom');
    });
    await expect(refresh()).rejects.toThrow('sync boom');
    // The session survives: only a REFRESH_TOKEN_REUSE_DETECTED /
    // NOT_FOUND / ALREADY_ROTATED verdict is allowed to clear it.
    expect(store.getState().chatSettingStore.user._id).toBe('u1');
    expect(store.getState().chatSettingStore.user.refreshToken).toBe('r');
  });
});

// ---- setBaseURL / getters ------------------------------------------

describe('setBaseURL + getters', () => {
  it('updates http.defaults.baseURL and the current app token', () => {
    const startedBase = getCurrentBaseURL();
    const startedTok = getCurrentAppToken();
    setBaseURL('https://override.test/v1', 'override-token');
    expect(fakeHttp.defaults.baseURL).toBe('https://override.test/v1');
    expect(getCurrentBaseURL()).toBe('https://override.test/v1');
    expect(getCurrentAppToken()).toBe('override-token');
    // reset so the rest of the suite isn't affected
    setBaseURL(startedBase, startedTok);
  });

  it('is a no-op when the new values are unchanged', () => {
    const before = fakeHttp.defaults.baseURL;
    setBaseURL(undefined, undefined);
    expect(fakeHttp.defaults.baseURL).toBe(before);
  });
});

// ---- interceptor: refreshTokens disabled ---------------------------

describe('interceptor — refreshTokens disabled (default)', () => {
  it('propagates the error (does NOT silently resolve undefined)', async () => {
    const onError = interceptorOnError();
    const err = { response: { status: 500 }, config: { url: '/x' } };
    await expect(onError(err)).rejects.toBe(err);
  });

  it('propagates a 401 too when refresh is not enabled', async () => {
    const onError = interceptorOnError();
    const err = { response: { status: 401 }, config: { url: '/x' } };
    await expect(onError(err)).rejects.toBe(err);
  });
});

// ---- interceptor: refreshTokens.enabled, refreshFunction path ------

describe('interceptor — refreshFunction path', () => {
  beforeEach(() => {
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        refreshTokens: {
          enabled: true,
          refreshFunction: () => ({
            accessToken: 'fn-access',
            refreshToken: 'fn-refresh',
          }),
        },
      } as any)
    );
  });

  it('non-401 errors still propagate', async () => {
    const onError = interceptorOnError();
    const err = { response: { status: 500 }, config: { url: '/x' } };
    await expect(onError(err)).rejects.toBe(err);
  });

  it('on 401 dispatches refreshTokens with the consumer-supplied tokens', async () => {
    const onError = interceptorOnError();
    (fakeHttp as jest.Mock).mockResolvedValueOnce({ data: 'retried' });
    const err = {
      response: { status: 401 },
      config: { url: '/x', headers: {} },
    };
    await onError(err);
    expect(store.getState().chatSettingStore.user.token).toBe('fn-access');
    expect(store.getState().chatSettingStore.user.refreshToken).toBe(
      'fn-refresh'
    );
  });

  it('stamps the new accessToken onto the original request and replays it', async () => {
    const onError = interceptorOnError();
    (fakeHttp as jest.Mock).mockResolvedValueOnce({ data: 'retried' });
    const original: any = { url: '/x', headers: {} };
    const err = { response: { status: 401 }, config: original };
    const res = await onError(err);
    expect(original.headers.Authorization).toBe('fn-access');
    expect(fakeHttp).toHaveBeenCalledWith(original);
    expect(res).toEqual({ data: 'retried' });
  });

  it('rejects if the refreshFunction throws', async () => {
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        refreshTokens: {
          enabled: true,
          refreshFunction: () => {
            throw new Error('refresh-fn-boom');
          },
        },
      } as any)
    );
    const onError = interceptorOnError();
    const err = {
      response: { status: 401 },
      config: { url: '/x', headers: {} },
    };
    await expect(onError(err)).rejects.toThrow('refresh-fn-boom');
  });
});

// ---- interceptor: built-in refresh path ----------------------------

describe('interceptor — built-in /users/login/refresh path', () => {
  beforeEach(() => {
    store.dispatch(
      setUser({ refreshToken: 'old-ref' } as any)
    );
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        refreshTokens: { enabled: true },
      } as any)
    );
  });

  it('short-circuits to reject when the failing request IS /users/login/refresh', async () => {
    const onError = interceptorOnError();
    const err = {
      response: { status: 401 },
      config: { url: '/users/login/refresh', headers: {} },
    };
    await expect(onError(err)).rejects.toBe(err);
    // No refresh post triggered (no recursion).
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('short-circuits to reject for /users/login too', async () => {
    const onError = interceptorOnError();
    const err = {
      response: { status: 401 },
      config: { url: '/users/login', headers: {} },
    };
    await expect(onError(err)).rejects.toBe(err);
  });

  it('refreshes, retries the original request, and resolves with the retry response', async () => {
    const onError = interceptorOnError();
    // 1. The refresh POST → returns fresh tokens.
    fakeHttp.post.mockResolvedValueOnce({
      data: { token: 'fresh-tok', refreshToken: 'fresh-ref' },
    });
    // 2. The retry call to http(originalRequest) → resolves with body.
    (fakeHttp as jest.Mock).mockResolvedValueOnce({ data: 'retried' });

    const original: any = { url: '/protected', headers: {} };
    const err = { response: { status: 401 }, config: original };
    const res = await onError(err);

    expect(fakeHttp.post).toHaveBeenCalledWith(
      '/users/login/refresh',
      {},
      { headers: { Authorization: 'old-ref' } }
    );
    expect(original.headers.Authorization).toBe('fresh-tok');
    expect(res).toEqual({ data: 'retried' });
    // Store updated to the new tokens.
    expect(store.getState().chatSettingStore.user.token).toBe('fresh-tok');
  });

  it('rejects when the refresh POST itself rejects', async () => {
    const onError = interceptorOnError();
    fakeHttp.post.mockRejectedValueOnce(new Error('refresh-failed'));
    const err = {
      response: { status: 401 },
      config: { url: '/protected', headers: {} },
    };
    await expect(onError(err)).rejects.toThrow('refresh-failed');
    // Replay was never attempted.
    expect(fakeHttp).not.toHaveBeenCalled();
  });

  it('shares ONE rotation across concurrent 401s and replays them all', async () => {
    const onError = interceptorOnError();

    // Hold the refresh POST open until we say so. Built up front: the
    // rotation awaits storage before it reaches http.post.
    let resolveRefresh!: (v: any) => void;
    const pendingRefresh = new Promise((res) => {
      resolveRefresh = res;
    });
    fakeHttp.post.mockReturnValueOnce(pendingRefresh);

    (fakeHttp as jest.Mock).mockImplementation((cfg: any) =>
      Promise.resolve({ data: `retry-of-${cfg.url}` })
    );

    const first: any = { url: '/protected', headers: {} };
    const second: any = { url: '/other', headers: {} };

    const firstP = onError({ response: { status: 401 }, config: first });
    const secondP = onError({ response: { status: 401 }, config: second });

    resolveRefresh({
      data: { token: 'queued-tok', refreshToken: 'queued-ref' },
    });

    const firstRes = await firstP;
    const secondRes = await secondP;

    expect(firstRes).toEqual({ data: 'retry-of-/protected' });
    expect(secondRes).toEqual({ data: 'retry-of-/other' });
    // Both replays carry the freshly rotated access token...
    expect(first.headers.Authorization).toBe('queued-tok');
    expect(second.headers.Authorization).toBe('queued-tok');
    // ...and crucially there was only ONE rotation. A second one would
    // have presented an already-burned refresh token.
    expect(fakeHttp.post).toHaveBeenCalledTimes(1);
  });

  it('does not retry a request that already carries _retry', async () => {
    const onError = interceptorOnError();
    const err = {
      response: { status: 401 },
      config: { url: '/protected', headers: {}, _retry: true },
    };

    await expect(onError(err)).rejects.toBe(err);
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });

  it('rejects without refreshing when there is no refreshable session', async () => {
    store.dispatch(setUser({ refreshToken: '' } as any));
    const onError = interceptorOnError();
    const err = {
      response: { status: 401 },
      config: { url: '/protected', headers: {} },
    };

    await expect(onError(err)).rejects.toBe(err);
    expect(fakeHttp.post).not.toHaveBeenCalled();
  });
});

// ---- interceptor: logout policy ------------------------------------

describe('interceptor — when the session is dead vs merely failing', () => {
  beforeEach(() => {
    store.dispatch(setUser({ _id: 'u1', refreshToken: 'old-ref' } as any));
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        refreshTokens: { enabled: true },
      } as any)
    );
  });

  it('logs out on REFRESH_TOKEN_REUSE_DETECTED', async () => {
    const onError = interceptorOnError();
    fakeHttp.post.mockRejectedValueOnce({
      response: {
        status: 401,
        data: { code: 'REFRESH_TOKEN_REUSE_DETECTED' },
        headers: {},
      },
    });

    await expect(
      onError({
        response: { status: 401 },
        config: { url: '/protected', headers: {} },
      })
    ).rejects.toBeDefined();

    expect(store.getState().chatSettingStore.user._id).toBe('');
  });

  it('keeps the session on a network failure', async () => {
    const onError = interceptorOnError();
    fakeHttp.post.mockRejectedValueOnce(new Error('Network Error'));

    await expect(
      onError({
        response: { status: 401 },
        config: { url: '/protected', headers: {} },
      })
    ).rejects.toThrow('Network Error');

    expect(store.getState().chatSettingStore.user._id).toBe('u1');
    expect(store.getState().chatSettingStore.user.refreshToken).toBe('old-ref');
  });

  it('keeps the session when the rotation loses a REFRESH_IN_PROGRESS race', async () => {
    const onError = interceptorOnError();
    fakeHttp.post.mockRejectedValue({
      response: {
        status: 401,
        data: { code: 'REFRESH_IN_PROGRESS' },
        headers: {},
      },
    });

    await expect(
      onError({
        response: { status: 401 },
        config: { url: '/protected', headers: {} },
      })
    ).rejects.toBeDefined();

    expect(store.getState().chatSettingStore.user._id).toBe('u1');
  });
});
