/**
 * E2EE, phase 5 - sealing attachments: the sliced cipher and the envelope.
 *
 * The sliced cipher has to be the OMEMO payload construction exactly, or a
 * file sealed here does not open on the web: it is checked against
 * ratchet.ts (which the web transcript fixture vouches for) in both
 * directions, around every boundary where slicing could go wrong.
 */

import { decryptPayload, encryptPayload } from '../src/e2ee/ratchet';
import { decryptLargePayload, encryptLargePayload } from '../src/e2ee/fileCipher';
import {
  decodeFileEnvelope,
  encodeFileEnvelope,
  openSealedFile,
  sealFileForUpload,
} from '../src/e2ee/fileEnvelope';
import { fromBase64, toHex } from '../src/e2ee/crypto';

const SLICE = 32 * 1024;
const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 131 + (i >> 8)) & 0xff);

describe('the sliced payload cipher', () => {
  // Empty, sub-block, block-aligned, and one either side of one and two slices.
  const sizes = [0, 1, 15, 16, 17, 1000, SLICE - 1, SLICE, SLICE + 1, SLICE + 16, 2 * SLICE, 2 * SLICE + 5, 150_000];

  it.each(sizes)('seals %i bytes the way the message payload is sealed', async (size) => {
    const plain = bytesOf(size);
    const sealed = await encryptLargePayload(plain);
    expect(sealed.keyMaterial).toHaveLength(48);
    expect(sealed.payload.length).toBe((Math.floor(size / 16) + 1) * 16);
    // The one-shot implementation opens it...
    expect(toHex(decryptPayload(sealed.keyMaterial, sealed.payload))).toBe(toHex(plain));
    // ...and its own output opens here.
    const reference = encryptPayload(plain);
    expect(toHex(await decryptLargePayload(reference.keyMaterial, reference.payload))).toBe(toHex(plain));
    expect(toHex(await decryptLargePayload(sealed.keyMaterial, sealed.payload))).toBe(toHex(plain));
  });

  it('reports progress up to completion, and yields between slices', async () => {
    const seen: number[] = [];
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const sealed = await encryptLargePayload(bytesOf(5 * SLICE + 3), (f) => seen.push(f));
    clearInterval(timer);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen[seen.length - 1]).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    // Other work got to run while it was encrypting.
    expect(ticks).toBeGreaterThan(0);

    const opened: number[] = [];
    await decryptLargePayload(sealed.keyMaterial, sealed.payload, (f) => opened.push(f));
    expect(opened[opened.length - 1]).toBe(1);
    expect([...opened].sort((a, b) => a - b)).toEqual(opened);
  });

  it('refuses a payload that was changed anywhere, before decrypting any of it', async () => {
    const sealed = await encryptLargePayload(bytesOf(3 * SLICE));
    for (const at of [0, SLICE, 3 * SLICE - 1, sealed.payload.length - 1]) {
      const tampered = sealed.payload.slice();
      tampered[at] ^= 1;
      await expect(decryptLargePayload(sealed.keyMaterial, tampered)).rejects.toThrow(
        'Payload authentication failed'
      );
    }
    const key = sealed.keyMaterial.slice();
    key[40] ^= 1;
    await expect(decryptLargePayload(key, sealed.payload)).rejects.toThrow('Payload authentication failed');
    await expect(decryptLargePayload(sealed.keyMaterial, sealed.payload.slice(0, -1))).rejects.toThrow(
      'Payload authentication failed'
    );
    await expect(decryptLargePayload(sealed.keyMaterial.slice(0, 32), sealed.payload)).rejects.toThrow(
      'Invalid key material'
    );
  });

  it('uses a fresh key every time', async () => {
    const a = await encryptLargePayload(bytesOf(100));
    const b = await encryptLargePayload(bytesOf(100));
    expect(toHex(a.keyMaterial)).not.toBe(toHex(b.keyMaterial));
    expect(toHex(a.payload)).not.toBe(toHex(b.payload));
  });
});

describe('the file envelope', () => {
  const meta = { mimetype: 'image/jpeg', originalname: 'фото з відпустки 🏖.jpg', size: 5 };

  it('round-trips metadata and bytes', () => {
    const envelope = encodeFileEnvelope(meta, Uint8Array.of(1, 2, 3, 4, 5));
    expect(String.fromCharCode(...envelope.slice(0, 8))).toBe('ETHOFILE');
    expect(envelope[8]).toBe(1);
    const decoded = decodeFileEnvelope(envelope);
    expect(decoded.meta).toEqual(meta);
    expect([...decoded.bytes]).toEqual([1, 2, 3, 4, 5]);
  });

  it('decodes from a view into a larger buffer', () => {
    const envelope = encodeFileEnvelope(meta, Uint8Array.of(9));
    const padded = new Uint8Array(envelope.length + 20);
    padded.set(envelope, 10);
    expect(decodeFileEnvelope(padded.subarray(10, 10 + envelope.length)).meta).toEqual(meta);
  });

  it('rejects what is not one of ours', () => {
    const envelope = encodeFileEnvelope(meta, Uint8Array.of(1));
    expect(() => decodeFileEnvelope(envelope.slice(0, 5))).toThrow('file_envelope_truncated');
    const badMagic = envelope.slice();
    badMagic[0] = 0;
    expect(() => decodeFileEnvelope(badMagic)).toThrow('file_envelope_bad_magic');
    const badVersion = envelope.slice();
    badVersion[8] = 2;
    expect(() => decodeFileEnvelope(badVersion)).toThrow('file_envelope_unsupported_version_2');
    // A forged header length must not read past the buffer.
    const forged = envelope.slice();
    new DataView(forged.buffer).setUint32(9, 0xffffff, false);
    expect(() => decodeFileEnvelope(forged)).toThrow('file_envelope_truncated');
  });
});

describe('sealing a file', () => {
  it('hides the name and the type, and gives them back on opening', async () => {
    const bytes = bytesOf(70_000);
    const sealed = await sealFileForUpload({ bytes, name: 'contract-final.pdf', type: 'application/pdf' });

    // Random, extension-free: nothing of the original on the outside.
    expect(sealed.filename).toMatch(/^[0-9a-f]{32}$/);
    expect(fromBase64(sealed.keyMaterial)).toHaveLength(48);
    const outside = Buffer.from(sealed.ciphertext).toString('latin1');
    expect(outside).not.toContain('contract-final');
    expect(outside).not.toContain('ETHOFILE');

    const opened = await openSealedFile(sealed.ciphertext, sealed.keyMaterial);
    expect(opened.meta).toEqual({ mimetype: 'application/pdf', originalname: 'contract-final.pdf', size: 70_000 });
    expect(toHex(opened.bytes)).toBe(toHex(bytes));
  });

  it('records a usable name and type when the picker gave none', async () => {
    const sealed = await sealFileForUpload({ bytes: Uint8Array.of(1, 2, 3) });
    const opened = await openSealedFile(sealed.ciphertext, sealed.keyMaterial);
    expect(opened.meta).toEqual({ mimetype: 'application/octet-stream', originalname: 'blob', size: 3 });
  });

  it('does not open with another file\'s key', async () => {
    const a = await sealFileForUpload({ bytes: bytesOf(100), name: 'a' });
    const b = await sealFileForUpload({ bytes: bytesOf(100), name: 'b' });
    await expect(openSealedFile(a.ciphertext, b.keyMaterial)).rejects.toThrow('Payload authentication failed');
  });
});
