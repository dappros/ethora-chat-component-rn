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
    fileToken?: string;
  }>(
    '/v1/users/login-with-email',
    {
      email,
      password,
    },
    { headers: { Authorization: getCurrentAppToken() } }
  );

  console.log('loginEmail res', res.data);

  // The fileToken arrives at the TOP level of the login response, next to
  // token/refreshToken — not inside `user`. Folding it in here is what
  // makes secure media (`secure-files.*`, uploaded via /v2/files/secure)
  // render at all: without it every such image 403s and the bubble comes
  // up blank.
  res.data.user = {
    ...res.data.user,
    fileToken: res.data.fileToken || '',
  };

  return res;
}

export function loginSocial(
  idToken: string,
  accessToken: string,
  loginType: string,
  authToken: string = 'authToken'
) {
  return http.post<any>(
    '/v1/users/login',
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
    '/v1/users',
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
    '/v1/users/checkEmail/' + email,

    { headers: { Authorization: getCurrentAppToken() } }
  );
}

export async function loginViaJwt(clientToken: string): Promise<User> {
  console.log('🟡 loginViaJwt: Sending JWT request to /users/client');
  const response = await http.post<{
    user: User;
    refreshToken: string;
    token: string;
    fileToken?: string;
  }>('/v1/users/client', null, { headers: { 'x-custom-token': clientToken } });

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
    // Top-level, same as loginEmail — see the note there.
    fileToken: response.data.fileToken || '',
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
  return http.post('/v1/files/', formData, {
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

const SECURE_UPLOAD_PATH = '/v2/files/secure';
const LEGACY_UPLOAD_PATH = '/v1/files/';

const cloneFormData = (formData: FormData): FormData => {
  const copy = new FormData();
  const source = formData as any;

  if (Array.isArray(source?._parts)) {
    for (const [key, value] of source._parts) {
      copy.append(key, value);
    }
    return copy;
  }

  if (typeof source?.forEach === 'function') {
    source.forEach((value: any, key: string) => copy.append(key, value));
    return copy;
  }

  if (typeof source?.getParts === 'function') {
    for (const part of source.getParts()) {
      // `headers` is derived by getParts() and must not be copied back —
      // RN regenerates it from the value.
      const { fieldName, string, headers: _headers, ...file } = part;
      copy.append(fieldName, string !== undefined ? string : file);
    }
  }

  return copy;
};

function postMultipart(
  url: string,
  body: FormData,
  path: string
): Promise<{ data: any }> {
  const token = store.getState().chatSettingStore?.user?.token ?? '';

  pushLog('http', `→ POST ${url} (xhr)`, {
    path,
    baseUrl: getCurrentBaseURL() || '[empty]',
    headers: {
      Authorization: token ? token.slice(0, 16) + '…' : '[empty]',
      Accept: '*/*',
    },
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const failNetwork = (reason: string) => {
      pushLog('http', `← ERR xhr ${path}`, { reason, url });
      const err: any = new Error(reason);
      err.code = 'ERR_NETWORK';
      err.config = { url: path };
      reject(err);
    };

    xhr.onload = () => {
      const status = xhr.status;
      let responseBody: any = null;
      try {
        responseBody = JSON.parse(xhr.responseText);
      } catch {
        responseBody = xhr.responseText || null;
      }

      if (status < 200 || status >= 300) {
        pushLog('http', `← ${status} POST ${path} (xhr)`, responseBody);
        const err: any = new Error(`Upload failed: ${status}`);
        // Shaped like an axios error so callers' `err.response.status`
        // checks keep working — notably useSendMessage's retry with the
        // singular "file" field on 500.
        err.response = { status, statusText: xhr.statusText, data: responseBody };
        err.config = { url: path };
        reject(err);
        return;
      }

      pushLog('http', `← ${status} POST ${path} (xhr)`, {
        resultsCount: Array.isArray(responseBody?.results)
          ? responseBody.results.length
          : 'n/a',
      });
      resolve({ data: responseBody });
    };

    xhr.onerror = () => failNetwork('Network request failed');
    xhr.ontimeout = () => failNetwork('Upload timed out');
    xhr.onabort = () => failNetwork('Upload aborted');

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', token);
    xhr.setRequestHeader('Accept', '*/*');
    // Deliberately no Content-Type — see the note above.
    xhr.send(body as any);
  });
}

const canFallBackToLegacyUpload = (error: unknown): boolean => {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (typeof status !== 'number') {return true;}
  return status !== 401 && status !== 413;
};

let secureUploadUnavailable = false;

export async function uploadFileV2(
  formData: FormData,
  activeRoomJID: string
): Promise<{ data: any }> {
  const chatName = (activeRoomJID || '').split('@')[0];
  const apiRoot = getCurrentBaseURL().replace(/\/$/, '');

  if (!secureUploadUnavailable && chatName) {
    const body = cloneFormData(formData);
    body.append('chatName', chatName);

    try {
      return await postMultipart(
        `${apiRoot}${SECURE_UPLOAD_PATH}`,
        body,
        SECURE_UPLOAD_PATH
      );
    } catch (error) {
      if (!canFallBackToLegacyUpload(error)) {throw error;}

      secureUploadUnavailable = true;
      console.warn(
        `[chat] ${SECURE_UPLOAD_PATH} unreachable, falling back to ${LEGACY_UPLOAD_PATH} for this session`,
        error
      );
    }
  }

  return postMultipart(
    `${apiRoot}${LEGACY_UPLOAD_PATH}`,
    formData,
    LEGACY_UPLOAD_PATH
  );
}

export const __resetSecureUploadLatchForTests = (): void => {
  secureUploadUnavailable = false;
};
