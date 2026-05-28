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

export async function uploadFileViaFetch(formData: FormData): Promise<{ data: any }> {
  const token = store.getState().chatSettingStore?.user?.token ?? '';
  const baseUrl = getCurrentBaseURL();
  const url = `${baseUrl.replace(/\/$/, '')}/files/`;

  pushLog('http', `→ POST ${url} (fetch)`, {
    headers: { Authorization: token ? token.slice(0, 16) + '…' : '[empty]', Accept: '*/*' },
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: token,
        Accept: '*/*',
      },
      body: formData as any,
    });
  } catch (e: any) {
    pushLog('http', `← ERR fetch /files/`, {
      name: e?.name,
      message: e?.message,
      stack: e?.stack,
    });
    const err: any = new Error(e?.message || 'Network request failed');
    err.code = 'ERR_NETWORK';
    err.cause = e;
    err.config = { url: '/files/' };
    throw err;
  }

  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      try { body = await res.text(); } catch { body = null; }
    }
    pushLog('http', `← ${res.status} POST /files/ (fetch)`, body);
    const err: any = new Error(`Upload failed: ${res.status}`);
    err.response = { status: res.status, statusText: res.statusText, data: body };
    err.config = { url: '/files/' };
    throw err;
  }

  const data = await res.json();
  pushLog('http', `← ${res.status} POST /files/ (fetch)`, {
    resultsCount: Array.isArray(data?.results) ? data.results.length : 'n/a',
  });
  return { data };
}
