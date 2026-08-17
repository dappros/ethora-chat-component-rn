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

// ---------------------------------------------------------------------
// `/v2/files/secure` -> `/v1/files` shim.
//
// Ported from the web chat-component so both clients behave identically:
// not every backend serves the secure, chat-scoped upload route, so a
// failed attempt retries against the legacy one — which must NOT see the
// `chatName` field the secure route requires. The first failure latches
// for the rest of the session, so we probe the secure route once, not on
// every upload.
//
// Two things had to be adapted, because they differ between the clients
// at the platform level rather than in behaviour:
//
//   1. Base URL. Web configures the API root and spells `/v1/...` into
//      every path; RN hosts configure `baseUrl` WITH the version
//      (`https://api…/v1`) and spell paths relative to it. So the secure
//      URL is built by stripping that version segment, which lands on
//      the same absolute URL both clients use.
//   2. FormData. React Native's polyfill has no `forEach`/`get`/`delete`
//      — see `cloneFormData`.
// ---------------------------------------------------------------------

const SECURE_UPLOAD_PATH = '/v2/files/secure';
const LEGACY_UPLOAD_PATH = '/files/';
let secureUploadUnavailable = false;

/** Absolute URL for the secure route — see note (1) above. */
const getSecureUploadUrl = (): string => {
  const base = getCurrentBaseURL().replace(/\/$/, '');
  const apiRoot = base.replace(/\/v\d+$/, '');
  return `${apiRoot}${SECURE_UPLOAD_PATH}`;
};

/**
 * Copy a FormData so the secure attempt can carry `chatName` while the
 * legacy retry gets the original body without it.
 *
 * React Native's FormData is a polyfill with only `append`, `getAll` and
 * `getParts` — the web version's `formData.forEach` does not exist here,
 * and neither does `delete`, which is why this copies rather than adding
 * and removing the field. `_parts` is the exact round-trip (it holds the
 * untouched `{ uri, type, name }` objects a picker produced); the other
 * two branches are fallbacks for a browser-like or future FormData.
 */
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
      // `headers` is derived by getParts() and must not be copied into
      // the new part — RN regenerates it from the value.
      const { fieldName, string, headers: _headers, ...file } = part;
      copy.append(fieldName, string !== undefined ? string : file);
    }
  }

  return copy;
};

const canFallBackToLegacyUpload = (error: unknown): boolean => {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (typeof status !== 'number') {return true;}
  return status !== 401 && status !== 413;
};

const chatNameFromJid = (activeRoomJID?: string): string =>
  (activeRoomJID || '').split('@')[0];

const warnSecureUnavailable = (error: unknown) => {
  console.warn(
    `[chat] ${SECURE_UPLOAD_PATH} unavailable, falling back to ${LEGACY_UPLOAD_PATH} for this session`,
    error
  );
};

const postUploadAxios = (url: string, formData: FormData) => {
  const token = store.getState().chatSettingStore?.user?.token ?? '';
  return http.post(url, formData, {
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
};

/**
 * `activeRoomJID` is optional here, unlike on web, because RN's
 * create-chat modals upload the avatar BEFORE the room exists and have
 * no JID to pass. Without one the secure route can't be addressed, so
 * that call goes straight to the legacy endpoint — deliberately WITHOUT
 * latching `secureUploadUnavailable`, which would otherwise disable the
 * secure route for message uploads too.
 */
export async function uploadFile(formData: FormData, activeRoomJID?: string) {
  const chatName = chatNameFromJid(activeRoomJID);

  if (!secureUploadUnavailable && chatName) {
    const secureData = cloneFormData(formData);
    secureData.append('chatName', chatName);

    try {
      return await postUploadAxios(getSecureUploadUrl(), secureData);
    } catch (error) {
      if (!canFallBackToLegacyUpload(error)) {throw error;}

      secureUploadUnavailable = true;
      warnSecureUnavailable(error);
    }
  }

  return postUploadAxios(LEGACY_UPLOAD_PATH, formData);
}

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
/**
 * `path` is the endpoint as callers know it ('/files/',
 * '/v2/files/secure'). It is what gets logged and what lands in
 * `err.config.url` — deliberately not the absolute `url`, so the error
 * shape stays exactly what it was before the secure route existed.
 */
function postUploadMultipart(
  url: string,
  formData: FormData,
  path: string
): Promise<{ data: any }> {
  const token = store.getState().chatSettingStore?.user?.token ?? '';

  pushLog('http', `→ POST ${url} (xhr)`, {
    headers: { Authorization: token ? token.slice(0, 16) + '…' : '[empty]', Accept: '*/*' },
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const failNetwork = (reason: string) => {
      pushLog('http', `← ERR xhr ${path}`, { reason });
      const err: any = new Error(reason);
      err.code = 'ERR_NETWORK';
      err.config = { url: path };
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
        pushLog('http', `← ${status} POST ${path} (xhr)`, body);
        const err: any = new Error(`Upload failed: ${status}`);
        // Shaped like an axios error so callers' `err.response.status`
        // checks keep working — notably useSendMessage's retry with the
        // singular "file" field on 500.
        err.response = { status, statusText: xhr.statusText, data: body };
        err.config = { url: path };
        reject(err);
        return;
      }

      pushLog('http', `← ${status} POST ${path} (xhr)`, {
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

/**
 * Same secure/legacy shim as `uploadFile`, over the XHR transport
 * documented above. Both entry points share one
 * `secureUploadUnavailable` latch, exactly like the single `uploadFile`
 * on web: one probe per session, whichever upload happens first.
 */
export async function uploadFileMultipart(
  formData: FormData,
  activeRoomJID?: string
): Promise<{ data: any }> {
  const chatName = chatNameFromJid(activeRoomJID);
  const legacyUrl = `${getCurrentBaseURL().replace(/\/$/, '')}${LEGACY_UPLOAD_PATH}`;

  if (!secureUploadUnavailable && chatName) {
    const secureData = cloneFormData(formData);
    secureData.append('chatName', chatName);

    try {
      return await postUploadMultipart(
        getSecureUploadUrl(),
        secureData,
        SECURE_UPLOAD_PATH
      );
    } catch (error) {
      if (!canFallBackToLegacyUpload(error)) {throw error;}

      secureUploadUnavailable = true;
      warnSecureUnavailable(error);
    }
  }

  return postUploadMultipart(legacyUrl, formData, LEGACY_UPLOAD_PATH);
}
