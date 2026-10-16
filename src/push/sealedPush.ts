import { fromBase64 } from '../e2ee/crypto';
import { sealedBoxKeyId, sealedBoxOpen } from './sealedBox';

// The envelope of an encrypted chat push (ethora-backend,
// services/push/README.md, "Encrypted pushes"): the FCM `data` map on
// Android, the custom keys next to `aps` on iOS. Only ids travel in the
// clear; everything shown to the user is inside `enc`, a sealed box for
// the key the device registered with its token.

export const SEALED_PUSH_ALG = 'sealed-box-x25519';
export const SEALED_PUSH_VERSION = '1';

export interface SealedPushEnvelope {
  v: string;
  alg: string;
  /** Id of the key the box was sealed for. */
  kid: string;
  /** Room JID. */
  jid: string;
  msgID: string;
  /** Recipient. */
  userJid: string;
  /** Base64 of the sealed box; absent when the service could not seal. */
  enc?: string;
}

/** What the box holds: the notification the service would have sent in the clear. */
export interface SealedPushContent {
  title: string;
  body: string;
  sender: string;
  senderJid: string;
  chat: string;
  chatJid: string;
  msgID: string;
  /** Sender avatar URL, '' when none. */
  image: string;
}

export type SealedPushFailure =
  /** No key on this device (never generated, or the store is not readable). */
  | 'no-key'
  /** Sealed for another key — the app was reinstalled or the key rotated after registration. */
  | 'key-mismatch'
  /** The service sent ids only (it could not seal). */
  | 'no-ciphertext'
  /** Not a box for our key, or damaged. */
  | 'bad-ciphertext'
  /** Opened, but the plaintext is not the expected JSON. */
  | 'bad-content';

export type OpenSealedPushResult =
  | { ok: true; content: SealedPushContent; envelope: SealedPushEnvelope }
  | { ok: false; reason: SealedPushFailure; envelope: SealedPushEnvelope };

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The envelope of `data` when it is a sealed chat push, else null. */
export const sealedPushEnvelopeOf = (
  data: Record<string, unknown> | null | undefined
): SealedPushEnvelope | null => {
  if (!data || data.alg !== SEALED_PUSH_ALG) {return null;}
  const enc = str(data.enc);
  return {
    v: str(data.v) || SEALED_PUSH_VERSION,
    alg: SEALED_PUSH_ALG,
    kid: str(data.kid),
    jid: str(data.jid),
    msgID: str(data.msgID),
    userJid: str(data.userJid),
    ...(enc ? { enc } : {}),
  };
};

export const isSealedPush = (data: Record<string, unknown> | null | undefined): boolean =>
  sealedPushEnvelopeOf(data) !== null;

const parseContent = (plaintext: Uint8Array): SealedPushContent | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (!parsed || typeof parsed !== 'object') {return null;}
    return {
      title: str(parsed.title),
      body: str(parsed.body),
      sender: str(parsed.sender),
      senderJid: str(parsed.senderJid),
      chat: str(parsed.chat),
      chatJid: str(parsed.chatJid),
      msgID: str(parsed.msgID),
      image: str(parsed.image),
    };
  } catch {
    return null;
  }
};

export interface SealedPushKey {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Open a sealed push with the device key. `key` null means there is no key
 * on this device. Never throws: every failure names why, so the caller can
 * show the placeholder and log the reason.
 */
export function openSealedPush(
  envelope: SealedPushEnvelope,
  key: SealedPushKey | null
): OpenSealedPushResult {
  if (!key) {return { ok: false, reason: 'no-key', envelope };}
  if (envelope.kid && envelope.kid !== sealedBoxKeyId(key.publicKey)) {
    return { ok: false, reason: 'key-mismatch', envelope };
  }
  if (!envelope.enc) {return { ok: false, reason: 'no-ciphertext', envelope };}
  let sealed: Uint8Array;
  try {
    sealed = fromBase64(envelope.enc);
  } catch {
    return { ok: false, reason: 'bad-ciphertext', envelope };
  }
  const plaintext = sealedBoxOpen(sealed, key.publicKey, key.secretKey);
  if (!plaintext) {return { ok: false, reason: 'bad-ciphertext', envelope };}
  const content = parseContent(plaintext);
  if (!content) {return { ok: false, reason: 'bad-content', envelope };}
  return { ok: true, content, envelope };
}
