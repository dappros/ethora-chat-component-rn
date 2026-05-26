import axios from 'axios';
import { store } from '../roomStore';

import { logout, refreshTokens } from '../roomStore/chatSettingsSlice';
import { installAxiosCapture } from '../utils/devLogger';

// Per product-code-policy: no compiled-in Ethora endpoints or tokens.
// Consumers must call `setBaseURL(baseUrl, appToken)` (or pass
// `baseUrl` + the token-bearing user / jwt-login config via the
// top-level `<Chat>` props) before any REST call is issued.
const DEFAULT_BASE_URL = '';

let currentBaseURL = DEFAULT_BASE_URL;
let currentAppToken: string = '';

const http = axios.create({
  baseURL: currentBaseURL,
});

// Dev-logger hook: capture every request + response on the shared
// `http` instance.
installAxiosCapture(http);

export function setBaseURL(baseUrl?: string, appToken?: string) {
  if (baseUrl && baseUrl !== currentBaseURL) {
    currentBaseURL = baseUrl;
    http.defaults.baseURL = baseUrl;
  }
  if (appToken && appToken !== currentAppToken) {
    currentAppToken = appToken;
  }
}

export function getCurrentAppToken() {
  return currentAppToken;
}

export function getCurrentBaseURL() {
  return currentBaseURL;
}

export function refresh(): Promise<{
  data: { refreshToken: string; token: string };
}> {
  return new Promise((resolve, reject) => {
    const user = store.getState().chatSettingStore.user;
    try {
      http
        .post(
          '/users/login/refresh',
          {},
          { headers: { Authorization: user.refreshToken } }
        )
        .then((response) => {
          store.dispatch(
            refreshTokens({
              token: response.data.token,
              refreshToken: response.data.refreshToken,
            })
          );
          // BUGFIX: previously the `.then` only dispatched and never
          // resolved, so every `await refresh()` callsite hung forever
          // on the happy path. Resolve with the axios response shape so
          // the interceptor can read `tokens.data.token` to retry.
          resolve(response);
        })
        .catch((error) => {
          reject(error);
        });
    } catch (error) {
      // BUGFIX: previously the outer-try catch dispatched logout but
      // never rejected, so a synchronous throw from `http.post` (e.g.
      // a bad URL) would hang the promise. Reject explicitly.
      console.log('errr');
      store.dispatch(logout());
      reject(error);
    }
  });
}

let isRefreshing = false;
let failedQueue: any[] = [];

const addRequestToQueue = (config: any) => {
  return new Promise((resolve, reject) => {
    failedQueue.push({ resolve, reject, config });
  });
};

const processQueue = (newAccessToken: string) => {
  for (const request of failedQueue) {
    if (newAccessToken) {
      request.config.headers.Authorization = newAccessToken;
    }

    request.resolve(http(request.config));
  }

  failedQueue = [];
};

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    // BUGFIX: the original condition was `if (!enabled)` — inverted, so
    // turning `refreshTokens.enabled: true` actually DISABLED the refresh
    // path on 401. Use the correct sense.
    if (!store.getState().chatSettingStore?.config?.refreshTokens?.enabled) {
      // BUGFIX: previously this branch fell off the end of the async
      // function and returned `undefined`, which axios treats as a
      // resolved-with-undefined response. Callers expecting an error
      // got `undefined` instead, silently swallowing every failure
      // when the refresh path isn't configured. Re-reject so the
      // original error reaches the caller.
      return Promise.reject(error);
    }

    const originalRequest = error.config;
    const status = error.response?.status;

    // Refresh paths only fire on 401. Anything else passes through.
    if (!error.response || status !== 401) {
      return Promise.reject(error);
    }

    if (
      store.getState().chatSettingStore?.config?.refreshTokens?.refreshFunction
    ) {
      // Consumer-supplied refresh function. Call it, dispatch the new
      // tokens, retry the original request.
      try {
        const fn = store.getState().chatSettingStore?.config?.refreshTokens?.refreshFunction;
        if (!fn) return Promise.reject(error);
        const result = await fn();
        const { refreshToken: newRefreshToken, accessToken } = result || { refreshToken: '', accessToken: '' };
        store.dispatch(
          refreshTokens({
            token: accessToken,
            refreshToken: newRefreshToken || '',
          })
        );
        // BUGFIX: previously this branch returned `undefined` after
        // dispatching, so the original request was never retried and
        // the caller resolved with undefined. Stamp the new token on
        // the original config and replay.
        if (originalRequest?.headers) {
          originalRequest.headers.Authorization = accessToken;
        }
        return http(originalRequest);
      } catch (refreshErr) {
        return Promise.reject(refreshErr);
      }
    }

    // Built-in `/users/login/refresh` path. Skip if the failing request
    // IS the refresh / login itself — otherwise we'd loop forever.
    if (
      originalRequest.url === '/users/login/refresh' ||
      originalRequest.url === '/users/login'
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      const retryOriginalRequest = addRequestToQueue(originalRequest);
      return retryOriginalRequest;
    }

    isRefreshing = true;
    try {
      const tokens = await refresh();
      console.log('tokens', tokens);
      isRefreshing = false;
      originalRequest.headers.Authorization = tokens.data.token;
      processQueue(tokens.data.token);
      return http(originalRequest);
    } catch (refreshErr) {
      isRefreshing = false;
      // BUGFIX: previously this returned the error (resolving the
      // promise with the error as value) instead of rejecting, so
      // axios callers got the error as a "successful" response body.
      return Promise.reject(refreshErr);
    }
  }
);

export default http;
