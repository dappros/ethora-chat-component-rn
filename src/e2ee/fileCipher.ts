import { cbc } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesEqual, concatBytes, hkdfSha256, randomBytes } from './crypto';

const SLICE = 32 * 1024;
const BLOCK = 16;

export type Progress = (fraction: number) => void;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function payloadKeys(key: Uint8Array) {
  const km = hkdfSha256(key, undefined, 'OMEMO Payload', 80);
  return { enc: km.slice(0, 32), auth: km.slice(32, 64), iv: km.slice(64) };
}

export async function encryptLargePayload(
  plaintext: Uint8Array,
  onProgress?: Progress
): Promise<{ keyMaterial: Uint8Array; payload: Uint8Array }> {
  const key = randomBytes(32);
  const { enc, auth, iv } = payloadKeys(key);
  const payload = new Uint8Array((Math.floor(plaintext.length / BLOCK) + 1) * BLOCK);
  const mac = hmac.create(sha256, auth);

  let offset = 0;
  let chain = iv;
  while (plaintext.length - offset > SLICE) {
    const out = payload.subarray(offset, offset + SLICE);
    out.set(
      cbc(enc, chain, { disablePadding: true }).encrypt(
        plaintext.subarray(offset, offset + SLICE)
      )
    );
    mac.update(out);
    chain = out.slice(SLICE - BLOCK);
    offset += SLICE;
    onProgress?.(offset / plaintext.length);
    await yieldToUi();
  }
  const last = cbc(enc, chain).encrypt(plaintext.subarray(offset));
  payload.set(last, offset);
  mac.update(last);
  onProgress?.(1);

  return { keyMaterial: concatBytes(key, mac.digest().slice(0, 16)), payload };
}

export async function decryptLargePayload(
  keyMaterial: Uint8Array,
  payload: Uint8Array,
  onProgress?: Progress
): Promise<Uint8Array> {
  if (keyMaterial.length !== 48) {throw new Error('Invalid key material');}
  if (payload.length === 0 || payload.length % BLOCK !== 0) {
    throw new Error('Payload authentication failed');
  }
  const { enc, auth, iv } = payloadKeys(keyMaterial.slice(0, 32));

  const mac = hmac.create(sha256, auth);
  for (let offset = 0; offset < payload.length; offset += SLICE) {
    mac.update(payload.subarray(offset, offset + SLICE));
    onProgress?.((Math.min(offset + SLICE, payload.length) / payload.length) * 0.65);
    if (offset + SLICE < payload.length) {await yieldToUi();}
  }
  if (!bytesEqual(mac.digest().slice(0, 16), keyMaterial.slice(32))) {
    throw new Error('Payload authentication failed');
  }

  const plaintext = new Uint8Array(payload.length);
  let offset = 0;
  let chain = iv;
  while (payload.length - offset > SLICE) {
    const part = payload.subarray(offset, offset + SLICE);
    plaintext.set(cbc(enc, chain, { disablePadding: true }).decrypt(part), offset);
    chain = part.slice(SLICE - BLOCK);
    offset += SLICE;
    onProgress?.(0.65 + (offset / payload.length) * 0.35);
    await yieldToUi();
  }
  const last = cbc(enc, chain).decrypt(payload.subarray(offset));
  plaintext.set(last, offset);
  onProgress?.(1);
  return plaintext.subarray(0, offset + last.length);
}
