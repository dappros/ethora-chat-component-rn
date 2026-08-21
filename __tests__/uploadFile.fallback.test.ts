/**
 * Upload routing + the `/v2/files/secure` -> `/v1/files/` fallback.
 *
 * Three entry points, deliberately separate:
 *
 *   uploadFileV2 (XHR)        — message attachments. Secure route,
 *     scoped to the chat via `chatName`, with the fallback for backends
 *     that don't serve it.
 *   uploadFileMultipart (XHR) — the plain v1 upload it falls back to.
 *   uploadFile (axios)        — avatars / room icons. Always
 *     `/v1/files/`: a room icon must render for every member, and an
 *     avatar picked while CREATING a chat has no chat to be scoped to.
 */

jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
  getCurrentAppToken: () => 'app-token',
  getCurrentBaseURL: () => 'https://api.example.com',
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
const SECURE_URL = 'https://api.example.com/v2/files/secure';
const LEGACY_URL = 'https://api.example.com/v1/files/';

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

/** A stand-in for React Native's FormData polyfill (no forEach/get). */
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

const fieldValue = (formData: any, key: string) => {
  const parts = formData?._parts as Array<[string, unknown]> | undefined;
  if (Array.isArray(parts)) {
    const hit = parts.find(([name]) => name === key);
    return hit ? hit[1] : null;
  }
  return formData?.get?.(key) ?? null;
};

class FakeXhr {
  static instances: FakeXhr[] = [];
  static respond: (xhr: FakeXhr) => void = () => {};

  status = 200;
  statusText = 'OK';
  responseText = JSON.stringify({ results: [] });
  url = '';
  sentBody: any = null;
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
  send(body: any) {
    this.sentBody = body;
    FakeXhr.respond(this);
    if (this.status === 0) {
      this.onerror?.();
      return;
    }
    this.onload?.();
  }
}

const originalXhr = (global as any).XMLHttpRequest;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  FakeXhr.instances = [];
  FakeXhr.respond = () => {};
  (global as any).XMLHttpRequest = FakeXhr as any;
});

afterEach(() => {
  (global as any).XMLHttpRequest = originalXhr;
  (console.warn as jest.Mock).mockRestore?.();
});

/** Make the secure attempt fail with `status`; the legacy one succeeds. */
const failSecureWith = (status: number) => {
  FakeXhr.respond = (xhr) => {
    if (xhr.url === SECURE_URL) {
      xhr.status = status;
      xhr.responseText = '{}';
    }
  };
};

describe('uploadFileV2 — message attachments', () => {
  it('posts to /v2/files/secure with the chat name derived from the JID', async () => {
    const { uploadFileV2 } = loadModule();

    await uploadFileV2(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances).toHaveLength(1);
    expect(FakeXhr.instances[0].url).toBe(SECURE_URL);
    expect(fieldValue(FakeXhr.instances[0].sentBody, 'chatName')).toBe(
      'room-id'
    );
  });

  it('retries against /v1/files/ WITHOUT chatName when the secure route 404s', async () => {
    const { uploadFileV2 } = loadModule();
    failSecureWith(404);

    await uploadFileV2(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances).toHaveLength(2);
    expect(FakeXhr.instances[1].url).toBe(LEGACY_URL);
    // The legacy route rejects the field the secure one requires.
    expect(fieldValue(FakeXhr.instances[1].sentBody, 'chatName')).toBeNull();
    // ...and the file itself must survive into the retry.
    expect(fieldValue(FakeXhr.instances[1].sentBody, 'files')).toBeTruthy();
  });

  it('falls back when the secure route fails with no response at all', async () => {
    const { uploadFileV2 } = loadModule();
    FakeXhr.respond = (xhr) => {
      if (xhr.url === SECURE_URL) {
        xhr.status = 0; // triggers onerror — a network failure
      }
    };

    await uploadFileV2(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances[1].url).toBe(LEGACY_URL);
  });

  it('stops probing the secure route after the first failure', async () => {
    const { uploadFileV2 } = loadModule();
    failSecureWith(404);

    await uploadFileV2(makeFormData(), ROOM_JID);
    FakeXhr.instances = [];
    await uploadFileV2(makeFormData(), ROOM_JID);

    expect(FakeXhr.instances).toHaveLength(1);
    expect(FakeXhr.instances[0].url).toBe(LEGACY_URL);
  });

  it('rethrows a 401 instead of retrying — that is the refresh interceptor’s job', async () => {
    const { uploadFileV2 } = loadModule();
    failSecureWith(401);

    await expect(
      uploadFileV2(makeFormData(), ROOM_JID)
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it('rethrows a 413 — an oversized file fails the same way on either route', async () => {
    const { uploadFileV2 } = loadModule();
    failSecureWith(413);

    await expect(
      uploadFileV2(makeFormData(), ROOM_JID)
    ).rejects.toMatchObject({ response: { status: 413 } });
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it('clones a React-Native FormData (no forEach/get) without losing the file', async () => {
    // The device path: RN's polyfill exposes only `_parts`, so the clone
    // has to read that. A silent miss would post `chatName` and no file.
    const { uploadFileV2 } = loadModule();

    await uploadFileV2(
      makeRnFormData() as unknown as FormData,
      ROOM_JID
    );

    const body = FakeXhr.instances[0].sentBody;
    expect(fieldValue(body, 'chatName')).toBe('room-id');
    expect(fieldValue(body, 'files')).toBeTruthy();
  });

  it('goes straight to /v1/files/ when there is no room JID, without latching', async () => {
    const { uploadFileV2 } = loadModule();

    await uploadFileV2(makeFormData());
    expect(FakeXhr.instances[0].url).toBe(LEGACY_URL);

    // The secure route must still be probed for a send that DOES have a
    // chat to scope to.
    FakeXhr.instances = [];
    await uploadFileV2(makeFormData(), ROOM_JID);
    expect(FakeXhr.instances[0].url).toBe(SECURE_URL);
  });
});

describe('uploadFile — avatars and room icons', () => {
  it('always posts to /v1/files/ and never probes the secure route', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockResolvedValue({ data: { results: [{ location: 'u' }] } });

    await uploadFile(makeFormData());

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/v1/files/');
    // No chat to scope an icon to — and it must stay readable by every
    // member, so it is deliberately not membership-gated.
    expect(fieldValue(post.mock.calls[0][1], 'chatName')).toBeNull();
  });

  it('cannot latch the secure route off for message uploads', async () => {
    const { uploadFile, uploadFileV2 } = loadModule();
    const post = postMock();
    post.mockRejectedValueOnce({ response: { status: 404 } });

    await expect(uploadFile(makeFormData())).rejects.toMatchObject({
      response: { status: 404 },
    });

    await uploadFileV2(makeFormData(), ROOM_JID);
    expect(FakeXhr.instances[0].url).toBe(SECURE_URL);
  });

  it('propagates upload errors to the caller', async () => {
    const { uploadFile } = loadModule();
    const post = postMock();
    post.mockRejectedValueOnce({ response: { status: 413 } });

    await expect(uploadFile(makeFormData())).rejects.toMatchObject({
      response: { status: 413 },
    });
  });
});
