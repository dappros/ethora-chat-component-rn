import axios from 'axios';
import { store } from '../roomStore';
import { appToken as betaAppToken } from '../../api.config';

import { logout, refreshTokens } from '../roomStore/chatSettingsSlice';
import { setLogoutState } from '../roomStore/roomsSlice';

let baseURL =
  store.getState().chatSettingStore?.config?.baseUrl ||
  'https://api.ethoradev.com/v1';

const http = axios.create({
  baseURL,
});

let appToken = betaAppToken;

export function setBaseURL(newBaseURL?: string, customAppToken?: string) {
  if (newBaseURL) {
    baseURL = newBaseURL;
    http.defaults.baseURL = newBaseURL;
  }
  if (customAppToken) {
    appToken = customAppToken;
  }
}

export function refresh(): Promise<{
  data: { refreshToken: string; token: string };
}> {
  console.log('refresh()');
  return new Promise((resolve, reject) => {
    const user = store.getState().chatSettingStore?.user;

    if(!user || !user.refreshToken) {
      reject(new Error('No user or refresh token'));
      return;
    }
    
    try {
      http
        .post(
          '/users/login/refresh',
          {},
          { headers: { Authorization: user.refreshToken } }
        )
        .then((response) => {
          if (!response) {
            reject(new Error('Invalid refresh response: response is undefined'));
            return;
          }
          
          if (!response.data) {
            reject(new Error('Invalid refresh response: response.data is undefined'));
            return;
          }
          
          if (response.data.token && response.data.refreshToken) {
            store.dispatch(
              refreshTokens({
                token: response.data.token,
                refreshToken: response.data.refreshToken,
              })
            );
            resolve({
              data: {
                token: response.data.token,
                refreshToken: response.data.refreshToken,
              },
            });
          } else {
            reject(new Error('Invalid refresh response: missing token or refreshToken'));
          }
        })
        .catch((error) => {
          console.error('Refresh token error:', error);
          reject(error);
        });
    } catch (error) {
      console.error('Refresh token exception:', error);
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
      request.config.headers['Authorization'] = newAccessToken;
    }

    request.resolve(http(request.config));
  }

  failedQueue = [];
};

http.interceptors.request.use(
  (config) => {
    const user = store.getState().chatSettingStore?.user;
    const token = user?.token;
    
    if (
      config.url !== '/users/login' &&
      config.url !== '/users/login/refresh' &&
      config.url !== '/users/client' &&
      !token
    ) {
      console.warn('No token found, logging out user');
      store.dispatch(logout());
      store.dispatch(setLogoutState());
      return Promise.reject(new Error('No authentication token'));
    }
    
    if (token && !config.headers['Authorization']) {
      config.headers['Authorization'] = token;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (store.getState().chatSettingStore?.config?.refreshTokens?.enabled) {
      const refreshFunction = store.getState().chatSettingStore?.config?.refreshTokens?.refreshFunction;
      if (refreshFunction) {
        try {
          const result = await refreshFunction();
          if (result?.accessToken && result?.refreshToken) {
            store.dispatch(
              refreshTokens({
                token: result.accessToken,
                refreshToken: result.refreshToken,
              })
            );
            const originalRequest = error.config;
            if (originalRequest) {
              originalRequest.headers['Authorization'] = result.accessToken;
              return http(originalRequest);
            }
            return Promise.reject(error);
          } else {
            throw new Error('Invalid refresh function response');
          }
        } catch (error) {
          console.error('Custom refresh function failed:', error);
          store.dispatch(logout());
          store.dispatch(setLogoutState());
          return Promise.reject(error);
        }
      }
    }
    
    const originalRequest = error.config;

    if (!error.response || error.response.status !== 401) {
      return Promise.reject(error);
    }
        if (
          originalRequest.url === '/users/login/refresh' ||
          originalRequest.url === '/users/login' ||
          originalRequest.url === '/users/client'
        ) {
          console.warn('Authentication failed on auth endpoint, logging out user');
          store.dispatch(logout());
          store.dispatch(setLogoutState());
          return Promise.reject(error);
        }

        const user = store.getState().chatSettingStore?.user;
        if (!user?.refreshToken) {
          console.warn('No refresh token available, logging out user');
          store.dispatch(logout());
          store.dispatch(setLogoutState());
          return Promise.reject(error);
        }

        originalRequest._retry = true;

        if (isRefreshing) {
          const retryOriginalRequest = addRequestToQueue(originalRequest);

          return retryOriginalRequest;
        } else {
          isRefreshing = true;
          try {
            const tokens = await refresh();
            console.log('refresh tokens---', tokens);
            if (!tokens?.data?.token) {
              throw new Error('Invalid token response');
            }
            isRefreshing = false;
            originalRequest.headers['Authorization'] = tokens.data.token;
            processQueue(tokens.data.token);
            return http(originalRequest);
          } catch (error) {
            isRefreshing = false;
            processQueue('');
            failedQueue.forEach((request) => {
              request.reject(error);
            });
            failedQueue = [];
            console.warn('Refresh token failed, logging out user');
            store.dispatch(logout());
            store.dispatch(setLogoutState());
            return Promise.reject(error);
          }
        }
  }
);

export default http;
export { appToken };
