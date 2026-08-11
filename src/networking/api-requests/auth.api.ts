import { User } from '../../types/types';

// import {
//   getAuth,
//   GoogleAuthProvider,
//   signInWithPopup,
//   User as FirebaseUser,
// } from 'firebase/auth';
// import { app } from '../../../firebase-config';

import http, { getCurrentAppToken, getCurrentBaseURL } from '../apiClient';
import { store } from '../../roomStore';
import { pushLog } from '../../utils/devLogger';

// login functions
export async function loginEmail(email: string, password: string) {
  const res = await http.post<{
    user: User;
    refreshToken: string;
    token: string;
  }>(
    '/users/login-with-email',
    {
      email,
      password,
    },
    { headers: { Authorization: getCurrentAppToken() } }
  );

  console.log('loginEmail res', res.data);

  return res;
}

export function loginSocial(
  idToken: string,
  accessToken: string,
  loginType: string,
  authToken: string = 'authToken'
) {
  return http.post<any>(
    '/users/login',
    {
      idToken,
      accessToken,
      loginType,
      authToken,
    },
    { headers: { Authorization: getCurrentAppToken() } }
  );
}

export function registerSocial(
  idToken: string,
  accessToken: string,
  authToken: string,
  loginType: string,
  signUpPlan?: string
) {
  return http.post(
    '/users',
    {
      idToken,
      accessToken,
      loginType,
      authToken: authToken,
      signupPlan: signUpPlan,
    },
    { headers: { Authorization: getCurrentAppToken() } }
  );
}

export function checkEmailExist(email: string) {
  return http.get(
    '/users/checkEmail/' + email,

    { headers: { Authorization: getCurrentAppToken() } }
  );
}

export async function loginViaJwt(clientToken: string): Promise<User> {
  console.log('🟡 loginViaJwt: Sending JWT request to /users/client');
  const response = await http.post<{
    user: User;
    refreshToken: string;
    token: string;
  }>('/users/client', null, { headers: { 'x-custom-token': clientToken } });

  console.log('✅ loginViaJwt: Received response', {
    hasUser: !!response.data.user,
    hasToken: !!response.data.token,
    hasRefreshToken: !!response.data.refreshToken,
    userData: response.data.user ? {
      _id: response.data.user._id,
      email: response.data.user.email,
      firstName: response.data.user.firstName,
      lastName: response.data.user.lastName,
      xmppUsername: response.data.user.xmppUsername,
    } : null,
  });

  const user = {
    ...response.data.user,
    refreshToken: response.data.refreshToken,
    token: response.data.token,
  };

  return user;
}

// export const signInWithGoogle = async () => {
//   const auth = getAuth(app);
//   const googleProvider = new GoogleAuthProvider();
//   googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');
//   googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');
//   try {
//     const res = await signInWithPopup(auth, googleProvider);
//     const user = res.user as FirebaseUser;
//     const idToken = await auth?.currentUser?.getIdToken();
//     const credential = GoogleAuthProvider.credentialFromResult(res);
//     return {
//       user,
//       idToken,
//       credential,
//     };
//   } catch (error) {
//     console.error(error);
//     return {};
//   }
// };

export function uploadFile(formData: FormData) {
  const token = store.getState().chatSettingStore?.user?.token ?? '';
  return http.post('/files/', formData, {
    headers: {
      Authorization: token,
      Accept: '*/*',
      'Content-Type': null,
    },
    transformRequest: (data: any, headers: any) => {
      if (headers?.delete) {headers.delete('Content-Type');}
      return data;
    },
  });
}

const UPLOAD_PATH = '/files/';

/**
 * Multipart upload of a picked file, sent over `XMLHttpRequest`.
 *
 * The transport matters here, and both obvious alternatives are wrong:
 *
 *   - `fetch`. Expo SDK 54 shipped a WinterCG-compliant fetch and SDK 57
 *     installs it as the GLOBAL fetch. It accepts only `Blob` / `File` /
 *     string form parts, so React Native's own `{ uri, type, name }` part
 *     — which is exactly what an image/document picker hands us — is
 *     rejected with "Unsupported FormDataPart implementation", surfacing
 *     to the caller as ERR_NETWORK. A host can set
 *     `EXPO_PUBLIC_USE_RN_FETCH=1`, but that opts their whole app out of
 *     Expo's fetch just to satisfy this SDK; not a cost we get to impose
 *     on a consumer.
 *   - axios. It forces its own `Content-Type: multipart/form-data`
 *     WITHOUT a boundary, so the server mis-parses one file as many and
 *     answers HTTP 413 TOO_MANY_FILES (bug #10 — this is why the upload
 *     was moved off axios in the first place).
 *
 * `XMLHttpRequest` avoids both. Expo replaces `fetch`, not `XHR`, so the
 * request still goes through React Native's native networking module,
 * which understands the `{ uri, type, name }` part, streams the file
 * straight from disk (a 50MB video never lands in JS memory) and writes
 * its own `Content-Type` with a valid boundary — which is precisely why
 * we must NOT set that header ourselves below.
 */
export function uploadFileMultipart(formData: FormData): Promise<{ data: any }> {
  const token = store.getState().chatSettingStore?.user?.token ?? '';
  const baseUrl = getCurrentBaseURL();
  const url = `${baseUrl.replace(/\/$/, '')}${UPLOAD_PATH}`;

  pushLog('http', `→ POST ${url} (xhr)`, {
    headers: { Authorization: token ? token.slice(0, 16) + '…' : '[empty]', Accept: '*/*' },
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const failNetwork = (reason: string) => {
      pushLog('http', `← ERR xhr ${UPLOAD_PATH}`, { reason });
      const err: any = new Error(reason);
      err.code = 'ERR_NETWORK';
      err.config = { url: UPLOAD_PATH };
      reject(err);
    };

    xhr.onload = () => {
      const status = xhr.status;
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = xhr.responseText || null;
      }

      if (status < 200 || status >= 300) {
        pushLog('http', `← ${status} POST ${UPLOAD_PATH} (xhr)`, body);
        const err: any = new Error(`Upload failed: ${status}`);
        // Shaped like an axios error so callers' `err.response.status`
        // checks keep working — notably useSendMessage's retry with the
        // singular "file" field on 500.
        err.response = { status, statusText: xhr.statusText, data: body };
        err.config = { url: UPLOAD_PATH };
        reject(err);
        return;
      }

      pushLog('http', `← ${status} POST ${UPLOAD_PATH} (xhr)`, {
        resultsCount: Array.isArray(body?.results) ? body.results.length : 'n/a',
      });
      resolve({ data: body });
    };

    xhr.onerror = () => failNetwork('Network request failed');
    xhr.ontimeout = () => failNetwork('Upload timed out');
    xhr.onabort = () => failNetwork('Upload aborted');

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', token);
    xhr.setRequestHeader('Accept', '*/*');
    // Deliberately no Content-Type — see the note above: RN fills it in
    // along with the multipart boundary it generated.
    xhr.send(formData as any);
  });
}
