import axios from 'axios';
import { store } from '../roomStore';

import { logout } from '../roomStore/chatSettingsSlice';
import { installAxiosCapture } from '../utils/devLogger';
import {
  refreshAuthTokens,
  isRefreshFatalError,
  RefreshResult,
} from './authRefresh';

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

/**
 * @deprecated Import `refreshAuthTokens` from `./authRefresh` instead.
 *
 * Kept as a thin forwarder so existing call sites keep working while
 * they migrate. Declared as a function (not `const refresh =
 * refreshAuthTokens`) on purpose: this module and `authRefresh` import
 * each other, and a const would capture the binding before the other
 * module finished evaluating.
 */
export function refresh(): Promise<RefreshResult> {
  return refreshAuthTokens();
}

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    // Refresh paths only fire on 401. Anything else passes through.
    if (!error.response || status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    // Never retry twice, and never touch the auth endpoints themselves —
    // both would recurse. (`_retry` was set but never checked before,
    // so a request could bounce between 401 and replay indefinitely.)
    if (
      originalRequest._retry ||
      originalRequest.url === '/users/login/refresh' ||
      originalRequest.url === '/users/login'
    ) {
      return Promise.reject(error);
    }

    const refreshConfig =
      store.getState().chatSettingStore?.config?.refreshTokens;

    // BUGFIX (kept): the original condition here was inverted, so
    // `refreshTokens.enabled: true` actually DISABLED the refresh path.
    if (!refreshConfig?.enabled) {
      return Promise.reject(error);
    }

    // Nothing to rotate with — reject rather than firing a doomed
    // refresh that would look like a bad-token event to the backend.
    const hasRefreshableSession = Boolean(
      refreshConfig.refreshFunction ||
        store.getState().chatSettingStore.user?.refreshToken
    );
    if (!hasRefreshableSession) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      // One shared rotation for every 401 in flight — `refreshAuthTokens`
      // dedupes internally, which replaces the old isRefreshing/
      // failedQueue machinery entirely.
      const tokens = await refreshAuthTokens();
      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers.Authorization = tokens.token;
      return http(originalRequest);
    } catch (refreshErr) {
      // Only a genuinely dead session logs the user out. A network
      // blip, a 5xx, or a REFRESH_IN_PROGRESS race must leave the
      // session alone — logging out on those is exactly the mass-logout
      // failure mode the new backend scheme would otherwise cause.
      if (isRefreshFatalError(refreshErr)) {
        store.dispatch(logout());
      }
      return Promise.reject(refreshErr);
    }
  }
);

export default http;
