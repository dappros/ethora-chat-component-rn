/**
 * Video preview cache.
 *
 * AVPlayer does not play from a server that answers a byte-range request
 * with 200 instead of 206 ("server is not correctly configured"), which is
 * what the secure-files host does - videos opened to a struck-through play
 * glyph on iOS. The preview falls back to a downloaded copy; this pins
 * where that copy lives and how the fallback is remembered.
 */

jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(),
}));

import {
  __resetVideoCacheForTests,
  downloadVideoToCache,
  findCachedVideo,
  getVideoCacheUri,
  isRemoteUrl,
  isStreamingUnsupported,
  markStreamingUnsupported,
} from '../src/helpers/videoCache';

const mockFs = jest.requireMock('expo-file-system/legacy') as Record<
  string,
  jest.Mock
>;

const URL = 'https://secure-files.host/secure-media/abc.mov?ft=token-1';

beforeEach(() => {
  jest.clearAllMocks();
  __resetVideoCacheForTests();
});

describe('getVideoCacheUri', () => {
  it('keeps the container extension AVFoundation needs', () => {
    expect(getVideoCacheUri(URL, 'video/quicktime', 'file:///c/')).toMatch(
      /^file:\/\/\/c\/ethora-video-[a-z0-9]+\.mov$/
    );
  });

  it('falls back to the mime type, then to mp4', () => {
    const opaque = 'https://files.host/blob/123';
    expect(getVideoCacheUri(opaque, 'video/webm', 'c/')).toMatch(/\.webm$/);
    expect(getVideoCacheUri(opaque, undefined, 'c/')).toMatch(/\.mp4$/);
    expect(getVideoCacheUri(opaque, 'application/octet-stream', 'c/')).toMatch(/\.mp4$/);
  });

  it('is the same file whatever token the url carries', () => {
    expect(getVideoCacheUri(URL, 'video/quicktime', 'c/')).toBe(
      getVideoCacheUri(URL.replace('token-1', 'token-2'), 'video/quicktime', 'c/')
    );
  });
});

describe('streaming fallback memory', () => {
  it('is per host', () => {
    expect(isStreamingUnsupported(URL)).toBe(false);
    markStreamingUnsupported(URL);
    expect(isStreamingUnsupported('https://secure-files.host/other.mp4')).toBe(true);
    expect(isStreamingUnsupported('https://cdn.host/other.mp4')).toBe(false);
  });
});

describe('cache lookups and downloads', () => {
  it('only treats http(s) as remote', () => {
    expect(isRemoteUrl(URL)).toBe(true);
    expect(isRemoteUrl('file:///a.mov')).toBe(false);
    expect(isRemoteUrl('')).toBe(false);
  });

  it('finds a finished download', async () => {
    mockFs.getInfoAsync.mockResolvedValueOnce({ exists: true });
    await expect(findCachedVideo(URL, 'video/quicktime')).resolves.toMatch(/\.mov$/);
    mockFs.getInfoAsync.mockResolvedValueOnce({ exists: false });
    await expect(findCachedVideo(URL, 'video/quicktime')).resolves.toBeNull();
  });

  it('downloads under another name and moves it into place', async () => {
    let finish: (value: any) => void = () => {};
    mockFs.createDownloadResumable.mockImplementation(
      (_url: string, _to: string, _opts: any, onProgress: any) => ({
        downloadAsync: () =>
          new Promise((resolve) => {
            onProgress({ totalBytesWritten: 50, totalBytesExpectedToWrite: 200 });
            finish = resolve;
          }),
      })
    );

    const progress: number[] = [];
    const first = downloadVideoToCache(URL, 'video/quicktime', (f) => progress.push(f));
    // A second caller joins the same download.
    const second = downloadVideoToCache(URL, 'video/quicktime');
    await Promise.resolve();
    await Promise.resolve();
    finish({ status: 200 });

    const uri = await first;
    await expect(second).resolves.toBe(uri);
    expect(mockFs.createDownloadResumable).toHaveBeenCalledTimes(1);
    expect(mockFs.createDownloadResumable.mock.calls[0][1]).toBe(`${uri}.part`);
    expect(mockFs.moveAsync).toHaveBeenCalledWith({ from: `${uri}.part`, to: uri });
    expect(progress).toEqual([0.25]);
  });

  it('rejects, and leaves no partial file, on a failed download', async () => {
    mockFs.createDownloadResumable.mockReturnValue({
      downloadAsync: async () => ({ status: 401 }),
    });
    await expect(downloadVideoToCache(URL, 'video/quicktime')).rejects.toThrow(
      'video_download_status_401'
    );
    expect(mockFs.moveAsync).not.toHaveBeenCalled();
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(expect.stringMatching(/\.part$/), {
      idempotent: true,
    });
  });
});
