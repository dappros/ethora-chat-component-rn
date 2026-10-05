import * as FileSystem from 'expo-file-system/legacy';
import { filenameFromUrl, getExtensionForMime } from './mimeToExtension';

// Containers the native players open from a local file by extension.
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|3gp|mkv|mpeg)$/i;

const hashString = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

export const isRemoteUrl = (url?: string | null): boolean =>
  /^https?:\/\//i.test(url || '');

const hostOf = (url: string): string =>
  (/^https?:\/\/(?:[^@/]+@)?([^:/?#]+)/i.exec(url)?.[1] || '').toLowerCase();

// The query carries the short-lived file token; the file is the same.
const withoutQuery = (url: string): string => url.split('#')[0]!.split('?')[0]!;

/**
 * Where a remote video is kept once downloaded. The extension matters:
 * AVFoundation picks the demuxer of a local file by it.
 */
export const getVideoCacheUri = (
  url: string,
  mimetype: string | undefined | null,
  cacheDirectory: string
): string => {
  const fromUrl = VIDEO_EXT_RE.exec(filenameFromUrl(url))?.[0];
  const fromMime = getExtensionForMime(mimetype);
  const ext = (
    fromUrl || (VIDEO_EXT_RE.test(fromMime) ? fromMime : '.mp4')
  ).toLowerCase();
  return `${cacheDirectory}ethora-video-${hashString(withoutQuery(url))}${ext}`;
};

/**
 * Hosts that answered a streaming attempt with an error. AVPlayer refuses a
 * server that replies 200 to a byte-range request ("server is not correctly
 * configured"), so for those the next video skips the doomed stream and
 * downloads straight away.
 */
const hostsWithoutStreaming = new Set<string>();

export const markStreamingUnsupported = (url: string): void => {
  const host = hostOf(url);
  if (host) {hostsWithoutStreaming.add(host);}
};

export const isStreamingUnsupported = (url: string): boolean =>
  hostsWithoutStreaming.has(hostOf(url));

export const findCachedVideo = async (
  url: string,
  mimetype?: string | null
): Promise<string | null> => {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory || !isRemoteUrl(url)) {return null;}
  try {
    const uri = getVideoCacheUri(url, mimetype, cacheDirectory);
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? uri : null;
  } catch {
    return null;
  }
};

type ProgressListener = (fraction: number) => void;

const inFlight = new Map<
  string,
  { promise: Promise<string>; listeners: Set<ProgressListener> }
>();

/**
 * Downloads the video next to the app's other caches and resolves with the
 * local uri. One download per file however many callers ask; `onProgress`
 * gets 0..1 when the server reports a length.
 */
export const downloadVideoToCache = (
  url: string,
  mimetype?: string | null,
  onProgress?: ProgressListener
): Promise<string> => {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    return Promise.reject(new Error('video_cache_unavailable'));
  }
  const finalUri = getVideoCacheUri(url, mimetype, cacheDirectory);

  const running = inFlight.get(finalUri);
  if (running) {
    if (onProgress) {running.listeners.add(onProgress);}
    return running.promise;
  }

  const listeners = new Set<ProgressListener>();
  if (onProgress) {listeners.add(onProgress);}

  const run = async (): Promise<string> => {
    // Download under another name: an interrupted download must not be
    // mistaken for the cached file next time.
    const part = `${finalUri}.part`;
    await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
    const task = FileSystem.createDownloadResumable(url, part, {}, (p) => {
      if (p.totalBytesExpectedToWrite > 0) {
        const fraction = Math.min(
          1,
          p.totalBytesWritten / p.totalBytesExpectedToWrite
        );
        listeners.forEach((listener) => listener(fraction));
      }
    });
    const result = await task.downloadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
      throw new Error(`video_download_status_${result?.status ?? 'cancelled'}`);
    }
    await FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
    await FileSystem.moveAsync({ from: part, to: finalUri });
    return finalUri;
  };

  const promise = run().finally(() => {
    inFlight.delete(finalUri);
  });
  inFlight.set(finalUri, { promise, listeners });
  return promise;
};

export const __resetVideoCacheForTests = (): void => {
  hostsWithoutStreaming.clear();
  inFlight.clear();
};
