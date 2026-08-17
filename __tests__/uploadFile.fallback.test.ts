/**
 * Covers the /v2/files/secure -> /v1/files shim in auth.api, ported from
 * the web chat-component's `uploadFile.fallback.test.ts` so both clients
 * are pinned to the same behaviour: not every backend serves the secure,
 * chat-scoped upload route, so a failed attempt has to retry against the
 * legacy one (which must NOT see the `chatName` field the secure route
 * requires).
 *
 * RN has two upload entry points instead of web's one — `uploadFile`
 * (axios, used by the avatar modals) and `uploadFileMultipart` (XHR,
 * used for chat attachments) — and they share the session latch, so
 * both are exercised here.
 */

jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
  getCurrentAppToken: () => 'app-token',
  getCurrentBaseURL: () => 'https://api.example.com/v1',
  setBaseURL: jest.fn(),
}));

jest.mock('../src/roomStore', () => ({
  __esModule: true,
  store: {
    getState: () => ({ chatSettingStore: { user: { token: 'tok' } } }),
  },
}));

jest.mock('../src/networking/api-requests/user.api', () => ({
  getMyUser: jest.fn(),
}));

jest.mock('../src/utils/devLogger', () => ({
  pushLog: jest.fn(),
  installAxiosCapture: jest.fn(),
}));

const ROOM_JID = 'room-id@conference.xmpp.example.com';

const postMock = () =>
  (jest.requireMock('../src/networking/apiClient') as any).default
    .post as jest.Mock;

// `secureUploadUnavailable` is module state that survives the first
// failure by design, so every test needs a fresh copy of the module.
const loadModule = () => {
  jest.resetModules();
  return require('../src/networking/api-requests/auth.api');
};

const makeFormData = () => {
  const formData = new FormData();
  formData.append('files', {
    uri: 'file:///tmp/photo.png',
    type: 'image/png',
    name: 'photo.png',
  } as any);
  return formData;
};

/**
 * Read a field back out.
 *
 * On a device `FormData` is React Native's polyfill, which exposes
 * `_parts` and no `get()`; under jest the global is the browser-shaped
 * one. `cloneFormData` handles both, so the assertions do too.
 */
const fieldValue = (formData: FormData, key: string) => {
  const parts = (formData as any)._parts as
    | Array<[string, unknown]>
    | undefined;
  if (Array.isArray(parts)) {
    const hit = parts.find(([name]) => name === key);
    return hit ? hit[1] : null;
  }
  return (formData as any).get?.(key) ?? null;
};

/** A stand-in for React Native's FormData polyfill. */
const makeRnFormData = () => ({
  _parts: [
    [
      'files',
      { uri: 'file:///tmp/photo.png', type: 'image/png', name: 'photo.png' },
    ],
  ] as Array<[string, unknown]>,
  append(key: string, value: unknown) {
    this._parts.push([key, value]);
  },
});

const httpError = (status: number) => ({ response: { status } });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore?.();
});

describe('uploadFile — secure/legacy endpoint fallback', () => {
  it('uses /v2/files/secure with the chat name derived from the JID', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockResolvedValue({ data: { results: [{ location: 'u' }] } });

    await uploadFile(makeFormData(), ROOM_JID);

    expect(post).toHaveBeenCalledTimes(1);
    const [endpoint, body] = post.mock.calls[0];
    // RN hosts configure baseUrl WITH the version segment, so the secure
    // route is addressed absolutely off the API root.
    expect(endpoint).toBe('https://api.example.com/v2/files/secure');
    expect(fieldValue(body, 'chatName')).toBe('room-id');
    expect(fieldValue(body, 'files')).toBeTruthy();
  });

  it('retries against /files without chatName when the secure route 404s', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    const legacyResponse = { data: { results: [{ location: 'legacy' }] } };
    post
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce(legacyResponse);

    const result = await uploadFile(makeFormData(), ROOM_JID);

    expect(result).toBe(legacyResponse);
    expect(post).toHaveBeenCalledTimes(2);
    const [endpoint, body] = post.mock.calls[1];
    expect(endpoint).toBe('/files/');
    expect(fieldValue(body, 'chatName')).toBeNull();
    // The file itself must survive into the retry.
    expect(fieldValue(body, 'files')).toBeTruthy();
  });

  it('falls back when the secure route fails with no response at all (network)', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: { results: [] } });

    await uploadFile(makeFormData(), ROOM_JID);

    expect(post.mock.calls[1][0]).toBe('/files/');
  });

  it('stops probing the secure route after the first failure', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValue({ data: { results: [] } });

    await uploadFile(makeFormData(), ROOM_JID);
    post.mockClear();
    await uploadFile(makeFormData(), ROOM_JID);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/files/');
  });

  it('rethrows a 401 instead of retrying — that is the refresh interceptor’s job', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockRejectedValueOnce(httpError(401));

    await expect(uploadFile(makeFormData(), ROOM_JID)).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rethrows a 413 — an oversized file fails the same way on either route', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockRejectedValueOnce(httpError(413));

    await expect(uploadFile(makeFormData(), ROOM_JID)).rejects.toMatchObject({
      response: { status: 413 },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('clones a React-Native FormData (no forEach/get) without losing the file', async () => {
    // The device path: RN's polyfill exposes only `_parts`, so the clone
    // has to read that. A silent miss here would send the secure request
    // with `chatName` and no file at all.
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockResolvedValue({ data: { results: [] } });

    await uploadFile(makeRnFormData() as unknown as FormData, ROOM_JID);

    const body = post.mock.calls[0][1];
    expect(fieldValue(body, 'chatName')).toBe('room-id');
    // Presence is the point: the failure mode being guarded is a clone
    // that silently drops the file and posts only `chatName`. The part's
    // identity can't be asserted here — the COPY is built with jest's
    // browser-shaped FormData, which stringifies a plain object on
    // append; on a device it is RN's polyfill, which stores it as-is.
    expect(fieldValue(body, 'files')).toBeTruthy();
  });

  it('goes straight to the legacy route when there is no room JID yet', async () => {
    // RN-only: the create-chat modals upload an avatar before the room
    // exists. That call must not latch the secure route off for the
    // uploads that DO have a JID.
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockResolvedValue({ data: { results: [] } });

    await uploadFile(makeFormData());
    expect(post.mock.calls[0][0]).toBe('/files/');

    post.mockClear();
    await uploadFile(makeFormData(), ROOM_JID);
    expect(post.mock.calls[0][0]).toBe(
      'https://api.example.com/v2/files/secure'
    );
  });
});

describe('uploadFileMultipart — same shim over the XHR transport', () => {
  class FakeXhr {
    static instances: FakeXhr[] = [];
    static respond: (xhr: FakeXhr) => void = () => {};

    status = 200;
    statusText = 'OK';
    responseText = JSON.stringify({ results: [] });
    url = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;

    constructor() {
      FakeXhr.instances.push(this);
    }
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    send() {
      FakeXhr.respond(this);
      this.onload?.();
    }
  }

  const originalXhr = (global as any).XMLHttpRequest;

  beforeEach(() => {
    FakeXhr.instances = [];
    FakeXhr.respond = () => {};
    (global as any).XMLHttpRequest = FakeXhr as any;
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = originalXhr;
  });

  it('posts to the secure URL with chatName', async () => {
    const { uploadFileMultipart } = loadModule();

    await uploadFileMultipart(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances).toHaveLength(1);
    expect(FakeXhr.instances[0].url).toBe(
      'https://api.example.com/v2/files/secure'
    );
  });

  it('falls back to the legacy URL when the secure route 404s', async () => {
    const { uploadFileMultipart } = loadModule();
    FakeXhr.respond = (xhr) => {
      if (xhr.url.includes('/v2/files/secure')) {
        xhr.status = 404;
        xhr.responseText = '{}';
      }
    };

    await uploadFileMultipart(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances).toHaveLength(2);
    expect(FakeXhr.instances[1].url).toBe('https://api.example.com/v1/files/');
  });

  it('shares the session latch with uploadFile', async () => {
    const { uploadFile, uploadFileMultipart } = loadModule();
    const post = postMock();
    post
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValue({ data: { results: [] } });

    // The axios entry point burns the single probe...
    await uploadFile(makeFormData(), ROOM_JID);
    // ...so the XHR one must not try the secure route again.
    await uploadFileMultipart(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances).toHaveLength(1);
    expect(FakeXhr.instances[0].url).toBe('https://api.example.com/v1/files/');
  });

  it('rethrows a 401 without falling back', async () => {
    const { uploadFileMultipart } = loadModule();
    FakeXhr.respond = (xhr) => {
      xhr.status = 401;
      xhr.responseText = '{}';
    };

    await expect(
      uploadFileMultipart(makeFormData(), ROOM_JID)
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(FakeXhr.instances).toHaveLength(1);
  });
});
