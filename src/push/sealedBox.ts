import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa.js';
import { clean, concatBytes, u32, u8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// libsodium's sealed box (`crypto_box_seal` / `crypto_box_seal_open`) on
// the noble primitives the e2ee code already ships, so the JS side needs
// no native libsodium. The push service seals every chat push for a
// device that registered an X25519 public key (ethora-backend,
// services/push/README.md, "Encrypted pushes"); this is the matching
// receiver. The iOS notification service extension decrypts the same
// boxes in Swift with libsodium (plugins/notification-service).
//
// Layout: ephemeral public key (32) || crypto_box(message, nonce,
// recipient pk, ephemeral sk), with crypto_box = XSalsa20-Poly1305 under
// HSalsa20(X25519 shared secret) and nonce = BLAKE2b-192(epk || rpk).
// `__tests__/sealedBox.test.ts` pins this against libsodium itself.

export const SEALED_BOX_PUBLIC_KEY_BYTES = 32;
export const SEALED_BOX_SECRET_KEY_BYTES = 32;
/** Ephemeral public key (32) + Poly1305 tag (16). */
export const SEALED_BOX_OVERHEAD_BYTES = 48;

const NONCE_BYTES = 24;
const SIGMA = u32(utf8ToBytes('expand 32-byte k'));
const ZERO_NONCE_PREFIX = new Uint32Array(4);

export interface SealedBoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export const generateSealedBoxKeyPair = (): SealedBoxKeyPair => {
  const { secretKey, publicKey } = x25519.keygen();
  return { publicKey, secretKey };
};

export const sealedBoxPublicKeyOf = (secretKey: Uint8Array): Uint8Array =>
  x25519.getPublicKey(secretKey);

/**
 * The key id the push service derives when the registration carries none:
 * the first 16 hex characters of SHA-256 over the raw public key. Sent back
 * as `kid` in every sealed push.
 */
export const sealedBoxKeyId = (publicKey: Uint8Array): string =>
  bytesToHex(sha256(publicKey)).slice(0, 16);

// crypto_box_beforenm: HSalsa20 over the X25519 shared secret.
const boxSharedKey = (theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array => {
  const shared = x25519.getSharedSecret(mySecretKey, theirPublicKey);
  const words = new Uint32Array(8);
  hsalsa(SIGMA, u32(shared), ZERO_NONCE_PREFIX, words);
  clean(shared);
  return u8(words);
};

const sealNonce = (ephemeralPublicKey: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array =>
  blake2b(concatBytes(ephemeralPublicKey, recipientPublicKey), { dkLen: NONCE_BYTES });

/** `crypto_box_seal`: used by the tests and the key tool, not by the app. */
export function sealedBoxSeal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== SEALED_BOX_PUBLIC_KEY_BYTES) {
    throw new Error('sealedBoxSeal: the public key must be 32 bytes');
  }
  const ephemeral = generateSealedBoxKeyPair();
  const key = boxSharedKey(recipientPublicKey, ephemeral.secretKey);
  const nonce = sealNonce(ephemeral.publicKey, recipientPublicKey);
  const box = xsalsa20poly1305(key, nonce).encrypt(message);
  clean(key, ephemeral.secretKey);
  return concatBytes(ephemeral.publicKey, box);
}

/**
 * `crypto_box_seal_open`. Returns null for anything that does not open:
 * a wrong key, a box for another key, a damaged or truncated box.
 */
export function sealedBoxOpen(
  sealed: Uint8Array,
  publicKey: Uint8Array,
  secretKey: Uint8Array
): Uint8Array | null {
  if (
    sealed.length < SEALED_BOX_OVERHEAD_BYTES ||
    publicKey.length !== SEALED_BOX_PUBLIC_KEY_BYTES ||
    secretKey.length !== SEALED_BOX_SECRET_KEY_BYTES
  ) {
    return null;
  }
  const ephemeralPublicKey = sealed.subarray(0, SEALED_BOX_PUBLIC_KEY_BYTES);
  const box = sealed.subarray(SEALED_BOX_PUBLIC_KEY_BYTES);
  let key: Uint8Array | null = null;
  try {
    key = boxSharedKey(ephemeralPublicKey, secretKey);
    const nonce = sealNonce(ephemeralPublicKey, publicKey);
    return xsalsa20poly1305(key, nonce).decrypt(box);
  } catch {
    return null;
  } finally {
    if (key) {clean(key);}
  }
}
