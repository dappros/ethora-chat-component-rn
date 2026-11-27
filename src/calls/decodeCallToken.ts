// Hermes has no global `atob` and RN ships no Buffer polyfill by default,
// so the JWT payload is decoded here by hand. Only used on the ~500-byte
// middle segment of a call token, so a table-driven loop is plenty fast
// and saves pulling a base64 dependency into the SDK.
const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const decodeBase64 = (input: string): string => {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = B64_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {continue;}
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
};

// A JWT payload is UTF-8, and decodeBase64 hands back one char per byte.
// Re-interpret those bytes as UTF-8 so non-ASCII caller names (accents,
// Cyrillic) survive instead of turning into mojibake on the ring screen.
const bytesToUtf8 = (binary: string): string => {
  try {
    return decodeURIComponent(
      binary
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return binary;
  }
};

// Pull the JWT payload out of the call-token. We only read non-sensitive
// claims (`sub` = caller display name; `metadata.callId`, `video.room`),
// no signature verification, which is fine because the server has already
// vetted the token and LiveKit will reject anything tampered with on
// connect. Returns null when the token isn't a parseable JWT.
export const decodeCallToken = (token: string): Record<string, any> | null => {
  if (!token || typeof token !== 'string') {return null;}
  const parts = token.split('.');
  if (parts.length < 2) {return null;}
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(bytesToUtf8(decodeBase64(padded))) as Record<string, any>;
  } catch {
    return null;
  }
};
