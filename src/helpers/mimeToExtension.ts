// MIME → file extension table for download/preview filename fallbacks.
// Centralized so FilePreviewModal, MediaMessage, and any future media
// surface share one source of truth. Keep additions sorted by category.

const MIME_TO_EXT: Record<string, string> = {
  // images
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',

  // video
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/webm': '.webm',
  'video/3gpp': '.3gp',
  'video/x-matroska': '.mkv',
  'video/mpeg': '.mpeg',

  // audio
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/webm': '.weba',

  // documents
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/rtf': '.rtf',

  // archives
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
};

const VALID_EXT_RE = /\.[a-z0-9]{1,8}$/i;

// Audio file extensions we recognise across the SDK. Used for the
// "looks like audio even when the mimetype is application/octet-stream"
// heuristic in MediaMessage / FilePreviewModal. Voice-message senders
// (web app, push voice memos) sometimes ship audio as octet-stream with
// no audio mime — sniffing the extension lets us still play it.
// `.bin` is intentionally NOT here: it's our own fallback extension for
// truly unknown payloads (see getExtensionForMime), not a real format.
const AUDIO_EXTENSIONS = [
  '.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac',
  '.weba', '.webm', '.opus', '.amr', '.3gp', '.3gpp',
] as const;
const AUDIO_EXT_RE = new RegExp(
  `(${AUDIO_EXTENSIONS.map((e) => e.replace('.', '\\.')).join('|')})$`,
  'i'
);
// Filename / URL substrings that strongly indicate a voice / audio
// payload even without an explicit audio extension — e.g. a web-app
// voicemail uploaded as application/octet-stream named "voicemail-…".
const AUDIO_NAME_HINT_RE =
  /(?:^|[_\-./])(voice|voicemail|audio|audio-message|audiomessage|recording|voice-?note)(?:[_\-./]|$)/i;

/**
 * Returns true when the (mime, fileName, url) triple looks like an
 * audio payload — either by mime, by recognised extension on the
 * filename or URL path, or by a voice-message naming hint. The hint
 * branch is what catches voicemails sent as `application/octet-stream`
 * with a generic `.bin` filename (customer-reported #9 voicemail).
 */
export function isLikelyAudio(
  mime: string | undefined | null,
  fileName?: string | null,
  url?: string | null
): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('audio/')) {return true;}
  // For octet-stream (and any other non-audio mime) fall through to the
  // filename / URL heuristics. We don't restrict to octet-stream — some
  // backends send no mime at all, or send text/plain by accident.
  const name = (fileName || '').toLowerCase();
  const urlLast = filenameFromUrl(url).toLowerCase();
  if (AUDIO_EXT_RE.test(name) || AUDIO_EXT_RE.test(urlLast)) {return true;}
  // Last resort: voice-message naming hint anywhere in the filename, the
  // URL's last segment, OR the URL's full path. Voicemails are commonly
  // hosted under `/voice/abc-123` or `/voicemail/abc-123` where the last
  // segment is an opaque id with no hint by itself.
  const urlPath = (() => {
    if (!url) {return '';}
    try {
      const noQuery = url.split('?')[0]!.split('#')[0]!;
      return decodeURIComponent(noQuery).toLowerCase();
    } catch {
      return '';
    }
  })();
  if (
    AUDIO_NAME_HINT_RE.test(name) ||
    AUDIO_NAME_HINT_RE.test(urlLast) ||
    AUDIO_NAME_HINT_RE.test(urlPath)
  ) {
    return true;
  }
  return false;
}

/**
 * Returns the conventional extension (including the leading dot) for a
 * MIME type, or `.bin` as a last-resort fallback so callers never end up
 * with an extension-less filename.
 */
export function getExtensionForMime(mime: string | undefined | null): string {
  if (!mime) {return '.bin';}
  const normalized = mime.toLowerCase().split(';')[0]!.trim();
  return MIME_TO_EXT[normalized] || '.bin';
}

/**
 * Parses a URL or file path and returns the last segment, URL-decoded,
 * stripped of query/hash. Returns `''` when nothing usable is present.
 */
export function filenameFromUrl(url: string | undefined | null): string {
  if (!url) {return '';}
  try {
    // Strip query + hash without depending on a real URL parser (some RN
    // URLs from CDNs do not parse cleanly).
    const noQuery = url.split('?')[0]!.split('#')[0]!;
    const last = noQuery.split('/').pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

/**
 * Ensures `fileName` ends with a valid extension. Strategy:
 *   1. If the input already has an extension, return it unchanged.
 *   2. Otherwise, derive the extension from `mime` and append it.
 *   3. If `mime` is unknown, append `.bin`.
 *
 * Empty/falsy filenames get a `media_<timestamp>` base before the
 * extension is appended so callers always get a usable filename.
 */
export function ensureFilenameHasExtension(
  fileName: string | undefined | null,
  mime: string | undefined | null
): string {
  const base =
    (fileName && fileName.trim()) || `media_${Date.now()}`;
  if (VALID_EXT_RE.test(base)) {return base;}
  return `${base}${getExtensionForMime(mime)}`;
}

/**
 * Best-effort filename derivation for a message bubble:
 *   - server-provided `fileName`
 *   - server-provided `originalName`
 *   - URL pathname
 *   - generic `media_<timestamp>` so we never render an empty label
 *
 * Always returns a string with a valid extension.
 */
export function deriveDisplayFilename(opts: {
  fileName?: string | null;
  originalName?: string | null;
  url?: string | null;
  mime?: string | null;
}): string {
  const candidate =
    (opts.fileName && opts.fileName.trim()) ||
    (opts.originalName && opts.originalName.trim()) ||
    filenameFromUrl(opts.url) ||
    '';
  return ensureFilenameHasExtension(candidate, opts.mime);
}
