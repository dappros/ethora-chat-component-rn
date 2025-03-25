import axios from 'axios';
import { store } from '../roomStore';

import { logout, refreshTokens } from '../roomStore/chatSettingsSlice';
import { VITE_API_URL } from '../../../../config/apiService';
import {asyncStorageSetItem} from "../../../../helpers/cache/asyncStorageSetItem.ts";

const baseURL = 'https://dev.api.platform.atomwcapps.com/v1';
export const basePerspectoURL = 'https://dev.perspecto.api.atomwcapps.com/v1';

const http = axios.create({
  baseURL,
});

const client = axios.create({
  baseURL: VITE_API_URL,
});

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
        .then(async (response) => {
          await asyncStorageSetItem("validTokenDate", new Date());
          store.dispatch(
            refreshTokens({
              token: response.data.token ||response.data.accessToken,
              refreshToken: response.data.refreshToken,
            })
          );
        })
        .catch((error) => {
          reject(error);
        });
    } catch (error) {
      console.log('errr');
      store.dispatch(logout());
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

const responseInterceeptor = async (error: { config: any; response: { status: number; }; }) => {
  if (!store.getState().chatSettingStore?.config?.refreshTokens?.enabled) {
    if (
      store.getState().chatSettingStore?.config?.refreshTokens
        ?.refreshFunction
    ) {
      const { refreshToken, accessToken } = store
        .getState()
        .chatSettingStore?.config?.refreshTokens?.refreshFunction();
      store.dispatch(
        refreshTokens({
          token: accessToken,
          refreshToken: refreshToken,
        })
      );
      return;
    } else {
      const originalRequest = error.config;

      if (!error.response || error.response.status !== 401) {
        throw error;
      }
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
      } else {
        isRefreshing = true;
        try {
          const tokens = await refresh();
          console.log('tokens', tokens);
          isRefreshing = false;
          originalRequest.headers['Authorization'] = tokens.data.token;
          processQueue(tokens.data.token);
          return http(originalRequest);
        } catch (error) {
          isRefreshing = false;
          return error;
        }
      }
    }
  }
}

// http.interceptors.response.use(
//   (response) => response,
//   async (error) => {
//     if (!store.getState().chatSettingStore?.config?.refreshTokens?.enabled) {
//       if (
//         store.getState().chatSettingStore?.config?.refreshTokens
//           ?.refreshFunction
//       ) {
//         const { refreshToken, accessToken } = store
//           .getState()
//           .chatSettingStore?.config?.refreshTokens?.refreshFunction();
//         store.dispatch(
//           refreshTokens({
//             token: accessToken,
//             refreshToken: refreshToken,
//           })
//         );
//         return;
//       } else {
//         const originalRequest = error.config;

//         if (!error.response || error.response.status !== 401) {
//           throw error;
//         }
//         if (
//           originalRequest.url === '/users/login/refresh' ||
//           originalRequest.url === '/users/login'
//         ) {
//           return Promise.reject(error);
//         }

//         originalRequest._retry = true;

//         if (isRefreshing) {
//           const retryOriginalRequest = addRequestToQueue(originalRequest);

//           return retryOriginalRequest;
//         } else {
//           isRefreshing = true;
//           try {
//             const tokens = await refresh();
//             console.log('tokens', tokens);
//             isRefreshing = false;
//             originalRequest.headers['Authorization'] = tokens.data.token;
//             processQueue(tokens.data.token);
//             return http(originalRequest);
//           } catch (error) {
//             isRefreshing = false;
//             return error;
//           }
//         }
//       }
//     }
//   }
// );

http.interceptors.response.use((response) => response, responseInterceeptor);
client.interceptors.response.use((response) => response, responseInterceeptor);

export {http, client};
