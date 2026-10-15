/**
 * A stalled upload must end: with no progress for the stall window the request
 * is aborted and the upload rejects, so the message waiting on it can fail and
 * be retried instead of staying pending forever.
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
  store: { getState: () => ({ chatSettingStore: { user: { token: 'tok' } } }) },
}));
jest.mock('../src/networking/api-requests/user.api', () => ({ getMyUser: jest.fn() }));
jest.mock('../src/utils/devLogger', () => ({ pushLog: jest.fn(), installAxiosCapture: jest.fn() }));

class HangingXhr {
  static instances: HangingXhr[] = [];
  status = 0;
  statusText = '';
  responseText = '';
  upload: { onprogress: ((e: any) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  constructor() {
    HangingXhr.instances.push(this);
  }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const originalXhr = (global as any).XMLHttpRequest;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  HangingXhr.instances = [];
  (global as any).XMLHttpRequest = HangingXhr as any;
});

afterEach(() => {
  jest.useRealTimers();
  (global as any).XMLHttpRequest = originalXhr;
  (console.warn as jest.Mock).mockRestore?.();
});

const load = () => {
  jest.resetModules();
  return require('../src/networking/api-requests/auth.api');
};

const formData = () => {
  const fd = new FormData();
  fd.append('files', { uri: 'file:///tmp/a.png', type: 'image/png', name: 'a.png' } as any);
  return fd;
};

describe('upload stall guard', () => {
  it('aborts and rejects an upload that never makes progress', async () => {
    const { uploadFileV2 } = load();
    const outcome = uploadFileV2(formData(), 'room@conference.x.com').then(
      () => 'ok',
      (e: any) => e?.code
    );
    // The secure attempt stalls, is aborted, and the legacy attempt stalls too.
    await jest.advanceTimersByTimeAsync(91_000);
    await jest.advanceTimersByTimeAsync(91_000);
    await expect(outcome).resolves.toBe('ERR_NETWORK');
    expect(HangingXhr.instances.length).toBe(2);
    expect(HangingXhr.instances.every((x) => x.aborted)).toBe(true);
  });

  it('progress keeps an upload alive past the stall window', async () => {
    const { uploadFileV2 } = load();
    const progress = jest.fn();
    let settled = false;
    uploadFileV2(formData(), 'room@conference.x.com', { onProgress: progress }).then(
      () => (settled = true),
      () => (settled = true)
    );
    const xhr = HangingXhr.instances[0];
    for (let i = 1; i <= 4; i++) {
      await jest.advanceTimersByTimeAsync(60_000);
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: i, total: 10 });
    }
    expect(xhr.aborted).toBe(false);
    expect(settled).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(40);
  });
});
