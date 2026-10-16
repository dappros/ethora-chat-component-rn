/**
 * Sealed box on noble, pinned against libsodium itself: the push service
 * seals with `libsodium-wrappers` (`crypto_box_seal`), so what libsodium
 * seals must open here and the other way round — with the same key id
 * the service derives.
 */
import sodium from 'libsodium-wrappers';
import {
  SEALED_BOX_OVERHEAD_BYTES,
  generateSealedBoxKeyPair,
  sealedBoxKeyId,
  sealedBoxOpen,
  sealedBoxPublicKeyOf,
  sealedBoxSeal,
} from '../src/push/sealedBox';

const text = (s: string) => new TextEncoder().encode(s);
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(async () => {
  await sodium.ready;
});

describe('sealed box', () => {
  it('opens what libsodium sealed for our key', () => {
    const pair = generateSealedBoxKeyPair();
    const plaintext = JSON.stringify({ title: 'Alice', body: 'héllo 👋', msgID: '1' });
    const sealed = sodium.crypto_box_seal(sodium.from_string(plaintext), pair.publicKey);

    const opened = sealedBoxOpen(sealed, pair.publicKey, pair.secretKey);
    expect(opened && utf8(opened)).toBe(plaintext);
  });

  it('libsodium opens what we sealed', () => {
    const pair = sodium.crypto_box_keypair();
    const sealed = sealedBoxSeal(text('round trip'), pair.publicKey);
    expect(sealed.length).toBe('round trip'.length + SEALED_BOX_OVERHEAD_BYTES);

    const opened = sodium.crypto_box_seal_open(sealed, pair.publicKey, pair.privateKey);
    expect(sodium.to_string(opened)).toBe('round trip');
  });

  it('round-trips an empty message and a 1000-character body', () => {
    const pair = generateSealedBoxKeyPair();
    for (const message of ['', 'x'.repeat(1000)]) {
      const opened = sealedBoxOpen(
        sealedBoxSeal(text(message), pair.publicKey),
        pair.publicKey,
        pair.secretKey
      );
      expect(opened && utf8(opened)).toBe(message);
    }
  });

  it('returns null instead of throwing for the wrong key, a damaged box and a short box', () => {
    const pair = generateSealedBoxKeyPair();
    const other = generateSealedBoxKeyPair();
    const sealed = sealedBoxSeal(text('secret'), pair.publicKey);

    expect(sealedBoxOpen(sealed, other.publicKey, other.secretKey)).toBeNull();
    expect(sealedBoxOpen(sealed, pair.publicKey, other.secretKey)).toBeNull();

    const damaged = sealed.slice();
    damaged[damaged.length - 1] ^= 1;
    expect(sealedBoxOpen(damaged, pair.publicKey, pair.secretKey)).toBeNull();

    expect(sealedBoxOpen(sealed.subarray(0, 40), pair.publicKey, pair.secretKey)).toBeNull();
    expect(sealedBoxOpen(new Uint8Array(0), pair.publicKey, pair.secretKey)).toBeNull();
    expect(sealedBoxOpen(sealed, pair.publicKey.subarray(0, 31), pair.secretKey)).toBeNull();
  });

  it('derives the public key from the secret key the way libsodium does', () => {
    const pair = sodium.crypto_box_keypair();
    expect(sealedBoxPublicKeyOf(pair.privateKey)).toEqual(pair.publicKey);
  });

  it('derives the key id the push service derives (first 16 hex of SHA-256 over the raw key)', () => {
    // The service hashes with node's crypto (push server, `parsePushKey`).
    const pair = generateSealedBoxKeyPair();
    const expected = require('crypto')
      .createHash('sha256')
      .update(Buffer.from(pair.publicKey))
      .digest('hex')
      .slice(0, 16);
    expect(sealedBoxKeyId(pair.publicKey)).toBe(expected);
    expect(sealedBoxKeyId(pair.publicKey)).toMatch(/^[0-9a-f]{16}$/);
  });
});
