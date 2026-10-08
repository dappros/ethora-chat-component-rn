import { cbc } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { concatBytes, randomBytes, utf8ToBytes };

export interface KeyPair {
  priv: Uint8Array;
  pub: Uint8Array;
}

export interface IdentityKey {
  seed: Uint8Array;
  pub: Uint8Array;
}

const ZERO_SALT = new Uint8Array(32);

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | undefined,
  info: string,
  length: number
): Uint8Array {
  return hkdf(sha256, ikm, salt ?? ZERO_SALT, utf8ToBytes(info), length);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

export function aesEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Uint8Array {
  return cbc(key, iv).encrypt(data);
}

export function aesDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Uint8Array {
  return cbc(key, iv).decrypt(data);
}

export function generateKeyPair(): KeyPair {
  const { secretKey, publicKey } = x25519.keygen();
  return { priv: secretKey, pub: publicKey };
}

export function generateIdentity(): IdentityKey {
  const { secretKey, publicKey } = ed25519.keygen();
  return { seed: secretKey, pub: publicKey };
}

export function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(priv, pub);
}

export function identityDhPrivate(identity: IdentityKey): Uint8Array {
  return ed25519.utils.toMontgomerySecret(identity.seed);
}

export function identityDhPublic(identityPub: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(identityPub);
}

export function sign(identity: IdentityKey, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, identity.seed);
}

export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  identityPub: Uint8Array
): boolean {
  try {
    return ed25519.verify(signature, message, identityPub);
  } catch {
    return false;
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {return false;}
  let diff = 0;
  for (let i = 0; i < a.length; i++) {diff |= a[i]! ^ b[i]!;}
  return diff === 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) {B64_VALUE[B64.charCodeAt(i)] = i;}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  if (i + 1 === bytes.length) {
    const n = bytes[i]! << 16;
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + '==';
  } else if (i + 2 === bytes.length) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '').replace(/=+$/, '');
  if (clean.length % 4 === 1) {throw new Error('Invalid base64');}
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? B64_VALUE[code]! : -1;
    if (value < 0) {throw new Error('Invalid base64');}
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomInt(min: number, max: number): number {
  const bytes = randomBytes(4);
  const n = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  return min + (n % (max - min + 1));
}

export function bytesToUtf8(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let units: number[] = [];
  const push = (unit: number) => {
    units.push(unit);
    if (units.length >= 8192) {
      chunks.push(String.fromCharCode.apply(null, units));
      units = [];
    }
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++]!;
    if (b < 0x80) {
      push(b);
      continue;
    }
    const extra = b >= 0xf0 && b < 0xf8 ? 3 : b >= 0xe0 ? 2 : b >= 0xc2 ? 1 : -1;
    let code = extra === 3 ? b & 0x07 : extra === 2 ? b & 0x0f : b & 0x1f;
    let valid = extra > 0 && b < 0xf8 && i + extra <= bytes.length;
    for (let k = 0; valid && k < extra; k++) {
      const next = bytes[i + k]!;
      if ((next & 0xc0) !== 0x80) {valid = false;}
      code = (code << 6) | (next & 0x3f);
    }
    if (
      !valid ||
      (extra === 2 && code < 0x800) ||
      (extra === 3 && (code < 0x10000 || code > 0x10ffff)) ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      push(0xfffd);
      continue;
    }
    i += extra;
    if (code > 0xffff) {
      code -= 0x10000;
      push(0xd800 | (code >> 10));
      push(0xdc00 | (code & 0x3ff));
    } else {
      push(code);
    }
  }
  if (units.length) {chunks.push(String.fromCharCode.apply(null, units));}
  return chunks.join('');
}
