import {
  bytesToUtf8,
  fromBase64,
  randomBytes,
  toBase64,
  toHex,
  utf8ToBytes,
} from './crypto';
import {
  decryptLargePayload,
  encryptLargePayload,
  type Progress,
} from './fileCipher';

export { parseSealedMediaBody } from './sealedBody';

const MAGIC = Uint8Array.from([0x45, 0x54, 0x48, 0x4f, 0x46, 0x49, 0x4c, 0x45]);
const VERSION = 1;
const HEADER_OFFSET = MAGIC.length + 1 + 4;

export interface FileEnvelopeMeta {
  mimetype: string;
  originalname: string;
  size: number;
}

export interface SealedFile {
  ciphertext: Uint8Array;
  keyMaterial: string;
  filename: string;
}

export function encodeFileEnvelope(
  meta: FileEnvelopeMeta,
  bytes: Uint8Array
): Uint8Array {
  const header = utf8ToBytes(
    JSON.stringify({
      mimetype: meta.mimetype,
      originalname: meta.originalname,
      size: meta.size,
    })
  );

  const out = new Uint8Array(HEADER_OFFSET + header.length + bytes.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = VERSION;
  new DataView(out.buffer).setUint32(MAGIC.length + 1, header.length, false);
  out.set(header, HEADER_OFFSET);
  out.set(bytes, HEADER_OFFSET + header.length);
  return out;
}

export function decodeFileEnvelope(envelope: Uint8Array): {
  meta: FileEnvelopeMeta;
  bytes: Uint8Array;
} {
  if (envelope.length < HEADER_OFFSET) {
    throw new Error('file_envelope_truncated');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (envelope[i] !== MAGIC[i]) {throw new Error('file_envelope_bad_magic');}
  }
  const version = envelope[MAGIC.length];
  if (version !== VERSION) {
    throw new Error(`file_envelope_unsupported_version_${version}`);
  }

  const headerLen = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength
  ).getUint32(MAGIC.length + 1, false);

  const bodyStart = HEADER_OFFSET + headerLen;
  if (bodyStart > envelope.length) {throw new Error('file_envelope_truncated');}

  const meta = JSON.parse(
    bytesToUtf8(envelope.subarray(HEADER_OFFSET, bodyStart))
  ) as FileEnvelopeMeta;

  return { meta, bytes: envelope.subarray(bodyStart) };
}

export async function sealFileForUpload(
  file: { bytes: Uint8Array; name?: string; type?: string },
  onProgress?: Progress
): Promise<SealedFile> {
  const envelope = encodeFileEnvelope(
    {
      mimetype: file.type || 'application/octet-stream',
      originalname: file.name || 'blob',
      size: file.bytes.length,
    },
    file.bytes
  );

  const { keyMaterial, payload } = await encryptLargePayload(envelope, onProgress);

  return {
    ciphertext: payload,
    keyMaterial: toBase64(keyMaterial),
    filename: toHex(randomBytes(16)),
  };
}

export async function openSealedFile(
  ciphertext: Uint8Array,
  keyMaterial: string,
  onProgress?: Progress
): Promise<{ meta: FileEnvelopeMeta; bytes: Uint8Array }> {
  return decodeFileEnvelope(
    await decryptLargePayload(fromBase64(keyMaterial), ciphertext, onProgress)
  );
}
