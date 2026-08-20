/**
 * api-requests/* — REST client wrappers.
 *
 * Mocks the shared `apiClient` (so the real axios + interceptors never
 * fire) and the redux store (so we control the token / config that
 * the wrappers read). Asserts on the URL + body + headers each wrapper
 * sends, plus the small bits of response shaping each does.
 */

// ----- mock apiClient (avoid pulling axios + the refresh interceptor)
jest.mock('../src/networking/apiClient', () => {
  const http: any = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    defaults: { baseURL: 'https://api.test' },
  };
  // auth.api reads the app token/base URL via the getter functions
  // (not the legacy static `appToken`), so the mock must provide them
  // or loginEmail/checkEmailExist send an `undefined` Authorization.
  return {
    __esModule: true,
    default: http,
    appToken: 'test-app-token',
    getCurrentAppToken: () => 'test-app-token',
    getCurrentBaseURL: () => 'https://api.test',
    setBaseURL: jest.fn(),
    // Paths now carry their own version; the helper is what keeps a
    // host-supplied `myEndpoint` working across the change.
    normalizeApiPath: (path?: string) =>
      !path || /^\/v\d+\//.test(path) ? path : `/v1${path}`,
  };
});

// ----- mock the shared store (lazy build — jest.mock hoists above
// imports, so any module-scope ref would be undefined here).
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

import http from '../src/networking/apiClient';
import { store } from '../src/roomStore';
import { setUser, setConfig } from '../src/roomStore/chatSettingsSlice';
import {
  getMyUser,
  getDocuments,
  deleteMe,
  updateMe,
  updateProfile,
} from '../src/networking/api-requests/user.api';
import {
  loginEmail,
  loginViaJwt,
  checkEmailExist,
  uploadFile,
  uploadFileV2,
} from '../src/networking/api-requests/auth.api';
import {
  getRooms,
  clearRoomsRestCache,
} from '../src/networking/api-requests/rooms.api';
import { getUserByXmppUsername } from '../src/networking/api-requests/roomMembers.api';

const mockHttp = http as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  mockHttp.get.mockReset();
  mockHttp.post.mockReset();
  mockHttp.put.mockReset();
  mockHttp.delete.mockReset();
  // Reset slices.
  store.dispatch({ type: 'chat/logout' });
  store.dispatch({ type: 'roomMessages/setLogoutState' });
  clearRoomsRestCache();
});

// ---- user.api -------------------------------------------------------

describe('user.api', () => {
  it('getMyUser: GETs /users/my with the redux token by default', async () => {
    store.dispatch(setUser({ token: 'redux-tok' } as any));
    mockHttp.get.mockResolvedValueOnce({ data: { user: { _id: 'u1' } } });
    const out = await getMyUser();
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/users/my',
      { headers: { Authorization: 'redux-tok' } }
    );
    expect(out).toEqual({ _id: 'u1' });
  });

  it('getMyUser: explicit token + endpoint options override the defaults', async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { _id: 'u2' } });
    const out = await getMyUser({
      token: 'explicit-tok',
      endpoint: '/users/special',
    });
    // The base URL no longer carries `/v1`, so a host-supplied endpoint
    // written the old way gets versioned rather than 404-ing.
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/users/special',
      { headers: { Authorization: 'explicit-tok' } }
    );
    // No `user` wrapper → returns response.data as-is.
    expect(out).toEqual({ _id: 'u2' });
  });

  it('getMyUser: an endpoint that already names its version is left alone', async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { _id: 'u3' } });
    await getMyUser({ token: 't', endpoint: '/v2/users/me' });
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v2/users/me',
      { headers: { Authorization: 't' } }
    );
  });

  it('getDocuments uses the Bearer token prefix', () => {
    store.dispatch(setUser({ token: 't1' } as any));
    getDocuments('0xabc');
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/docs/0xabc',
      { headers: { Authorization: 'Bearer t1' } }
    );
  });

  it('deleteMe + updateMe hit /users with the right verbs', () => {
    deleteMe();
    expect(mockHttp.delete).toHaveBeenCalledWith('/v1/users');
    updateMe({ firstName: 'A' });
    expect(mockHttp.put).toHaveBeenCalledWith('/v1/users', { firstName: 'A' });
  });

  it('updateProfile wraps the underlying error and rethrows', async () => {
    mockHttp.put.mockRejectedValueOnce(new Error('boom'));
    await expect(updateProfile({} as any)).rejects.toThrow(
      'Error updating profile'
    );
  });

  it('updateProfile returns response.data on success', async () => {
    mockHttp.put.mockResolvedValueOnce({ data: { user: { _id: 'u3' } } });
    const out = await updateProfile({} as any);
    expect(out).toEqual({ user: { _id: 'u3' } });
  });
});

// ---- auth.api -------------------------------------------------------

describe('auth.api', () => {
  it('loginEmail POSTs /users/login-with-email with the app token', async () => {
    mockHttp.post.mockResolvedValueOnce({ data: { token: 't', user: {} } });
    await loginEmail('a@b.com', 'pw');
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/v1/users/login-with-email',
      { email: 'a@b.com', password: 'pw' },
      { headers: { Authorization: 'test-app-token' } }
    );
  });

  it('loginViaJwt sends the client token under x-custom-token + merges {token, refreshToken} onto user', async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: {
        user: { _id: 'u', firstName: 'A' },
        token: 'srv-tok',
        refreshToken: 'srv-ref',
      },
    });
    const out = await loginViaJwt('client-jwt');
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/v1/users/client',
      null,
      { headers: { 'x-custom-token': 'client-jwt' } }
    );
    expect(out).toEqual({
      _id: 'u',
      firstName: 'A',
      token: 'srv-tok',
      refreshToken: 'srv-ref',
      fileToken: '',
    });
  });

  it('loginViaJwt folds the top-level fileToken onto the user', async () => {
    // It arrives next to token/refreshToken, not inside `user`. Missing
    // it means every secure-files image renders blank.
    mockHttp.post.mockResolvedValueOnce({
      data: {
        user: { _id: 'u', firstName: 'A' },
        token: 'srv-tok',
        refreshToken: 'srv-ref',
        fileToken: 'ft-1',
      },
    });

    const out = await loginViaJwt('client-jwt');

    expect(out.fileToken).toBe('ft-1');
  });

  it('checkEmailExist hits /users/checkEmail/<email>', () => {
    checkEmailExist('a@b.com');
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/users/checkEmail/a@b.com',
      { headers: { Authorization: 'test-app-token' } }
    );
  });

  it('uploadFile POSTs /files/ with the user token in Authorization', () => {
    store.dispatch(setUser({ token: 'user-tok' } as any));
    uploadFile({ fake: 'fd' } as any);
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/v1/files/',
      { fake: 'fd' },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'user-tok',
          Accept: '*/*',
        }),
      })
    );
  });

  it('uploadFile does NOT pre-set a string Content-Type so axios computes the multipart boundary', () => {
    // Pre-setting `Content-Type: multipart/form-data` strips the boundary
    // and the server returns 500 for non-image uploads. Regression guard
    // for bug #10 in sdk-bug-tracker.md.
    //
    // Two acceptable shapes: either the header isn't set at all, or it
    // is explicitly null (some axios builds prefer null + a
    // transformRequest deleter to forcibly drop the default). What we
    // must NEVER see is a string value.
    store.dispatch(setUser({ token: 'user-tok' } as any));
    uploadFile({ fake: 'fd' } as any);
    const headers = mockHttp.post.mock.calls[0]![2]!.headers;
    expect(typeof headers['Content-Type']).not.toBe('string');
    expect(typeof headers['content-type']).not.toBe('string');
  });
});

// ---- uploadFileMultipart (the media-send path) ----------------------
//
// Expo SDK 57 installs Expo's WinterCG fetch as the GLOBAL fetch, and it
// rejects React Native's `{ uri, type, name }` FormData part with
// "Unsupported FormDataPart implementation" → ERR_NETWORK. Expo does not
// replace XMLHttpRequest, so the upload rides RN's native networking
// module instead. These guard that it stays that way.

describe('auth.api.uploadFileV2', () => {
  class FakeXHR {
    static last: FakeXHR;
    status = 200;
    statusText = 'OK';
    responseText = '{"results":[{"location":"https://files.test/a.jpg"}]}';
    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: any = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;

    constructor() {
      FakeXHR.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send(body: any) {
      this.body = body;
      // Mimic the async completion the real XHR gives us.
      setTimeout(() => this.onload?.(), 0);
    }
  }

  const originalXHR = (global as any).XMLHttpRequest;

  beforeEach(() => {
    (global as any).XMLHttpRequest = FakeXHR;
    store.dispatch(setUser({ token: 'user-tok' } as any));
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = originalXHR;
  });

  it('POSTs the multipart body over XHR, never over global fetch', async () => {
    // A global fetch that fails the test if the upload reaches it — that
    // is the entire point of the XHR transport on Expo SDK 57.
    const originalFetch = (global as any).fetch;
    (global as any).fetch = jest.fn(() => {
      throw new Error('upload must not use global fetch');
    });

    const fd = { _parts: [['files', { uri: 'file:///tmp/a.jpg' }]] } as any;
    const out = await uploadFileV2(fd, 'room-id@conference.example.com');

    expect((global as any).fetch).not.toHaveBeenCalled();
    (global as any).fetch = originalFetch;

    const xhr = FakeXHR.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://api.test/v2/files/secure');
    expect(xhr.headers.Authorization).toBe('user-tok');
    // A COPY of the caller's body, carrying the chat scope. (Under Jest
    // the global FormData is browser-shaped, so read it either way — on
    // a device it is RN's `_parts` polyfill.)
    expect(xhr.body).not.toBe(fd);
    const sentChatName = xhr.body?._parts
      ? xhr.body._parts.find(([k]: [string]) => k === 'chatName')?.[1]
      : xhr.body?.get?.('chatName');
    expect(sentChatName).toBe('room-id');
    // ...and the caller's own object is left untouched, so a retry
    // doesn't send `chatName` twice.
    expect(fd._parts).toHaveLength(1);
    expect(out).toEqual({
      data: { results: [{ location: 'https://files.test/a.jpg' }] },
    });
  });

  it('does not set Content-Type, so RN supplies the multipart boundary', async () => {
    await uploadFileV2({ _parts: [] } as any, 'room-id@conference.example.com');
    // Setting it ourselves would strip the boundary RN generates and the
    // server would mis-parse one file as many (413 TOO_MANY_FILES —
    // bug #10 in sdk-bug-tracker.md).
    const headerNames = Object.keys(FakeXHR.last.headers).map((h) =>
      h.toLowerCase()
    );
    expect(headerNames).not.toContain('content-type');
  });

  it('rejects with an axios-shaped error so the 500 retry still fires', async () => {
    const pending = uploadFileV2(
      { _parts: [] } as any,
      'room-id@conference.example.com'
    );
    // send() already scheduled onload; flip the status before it runs.
    FakeXHR.last.status = 500;
    FakeXHR.last.statusText = 'Internal Server Error';
    FakeXHR.last.responseText = '{"error":"boom"}';

    await expect(pending).rejects.toMatchObject({
      response: { status: 500, data: { error: 'boom' } },
      config: { url: '/v2/files/secure' },
    });
  });

  it('surfaces a transport failure as ERR_NETWORK', async () => {
    class FailingXHR extends FakeXHR {
      send() {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    (global as any).XMLHttpRequest = FailingXHR;

    await expect(
      uploadFileV2({ _parts: [] } as any, 'room-id@conference.example.com')
    ).rejects.toMatchObject({ code: 'ERR_NETWORK' });
  });
});

// ---- rooms.api ------------------------------------------------------

describe('rooms.api.getRooms', () => {
  it('GETs /chats/my and returns response.data', async () => {
    store.dispatch(setUser({ token: 'tok' } as any));
    mockHttp.get.mockResolvedValueOnce({
      data: { items: [{ name: 'r1', _id: 'id1' }] },
    });
    const out = await getRooms();
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/chats/my',
      { headers: { Authorization: 'tok' } }
    );
    expect(out).toEqual({ items: [{ name: 'r1', _id: 'id1' }] });
  });

  it('caches by token for 60s — a second call within the window does not re-fetch', async () => {
    store.dispatch(setUser({ token: 'tok' } as any));
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'r1' }] } });
    await getRooms();
    await getRooms();
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it('clearRoomsRestCache forces a re-fetch on the next call', async () => {
    store.dispatch(setUser({ token: 'tok' } as any));
    mockHttp.get
      .mockResolvedValueOnce({ data: { items: [{ name: 'r1' }] } })
      .mockResolvedValueOnce({ data: { items: [{ name: 'r2' }] } });
    await getRooms();
    clearRoomsRestCache();
    await getRooms();
    expect(mockHttp.get).toHaveBeenCalledTimes(2);
  });

  it('dispatches an addRoom per item, deriving jid from config.xmppSettings.host', async () => {
    store.dispatch(setUser({ token: 'tok' } as any));
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        xmppSettings: { host: 'my.host' },
      } as any)
    );
    mockHttp.get.mockResolvedValueOnce({
      data: {
        items: [
          { name: 'r1', _id: 'id1', participants: 3 },
          { name: 'r2', _id: 'id2', jid: 'r2-explicit@conference.elsewhere' },
        ],
      },
    });
    await getRooms();
    const rooms = store.getState().rooms.rooms;
    expect(rooms['r1@conference.my.host']?.usersCnt).toBe(3);
    expect(rooms['r2-explicit@conference.elsewhere']?.name).toBe('r2');
  });

  it('returns {items: []} when the underlying GET rejects', async () => {
    store.dispatch(setUser({ token: 'tok' } as any));
    mockHttp.get.mockRejectedValueOnce(new Error('net'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const out = await getRooms();
    expect(out).toEqual({ items: [] });
    expect(logSpy).toHaveBeenCalledWith(
      'Error loading rooms via REST',
      expect.any(Error)
    );
    logSpy.mockRestore();
  });
});

// ---- roomMembers.api -----------------------------------------------

describe('roomMembers.api.getUserByXmppUsername', () => {
  it('returns res.data.result on success', async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: { result: { xmppUsername: '0xabc', firstName: 'Alice' } },
    });
    const out = await getUserByXmppUsername('0xabc', 'tok');
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/apps/users/0xabc',
      { headers: { Authorization: 'tok' } }
    );
    expect(out).toEqual({ xmppUsername: '0xabc', firstName: 'Alice' });
  });

  it('returns null + logs when the request rejects', async () => {
    mockHttp.get.mockRejectedValueOnce(new Error('404'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await getUserByXmppUsername('0xabc', 'tok');
    expect(out).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
