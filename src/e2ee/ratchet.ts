import {
  aesDecrypt,
  aesEncrypt,
  bytesEqual,
  concatBytes,
  dh,
  generateKeyPair,
  hkdfSha256,
  hmacSha256,
  identityDhPrivate,
  identityDhPublic,
  randomBytes,
  toBase64,
  verify,
  type IdentityKey,
  type KeyPair,
} from './crypto';
import {
  decodeAuthenticated,
  decodeMessage,
  encodeAuthenticated,
  encodeMessage,
} from './protobuf';

const MAX_SKIP = 1000;
const X3DH_PREFIX = new Uint8Array(32).fill(0xff);

export interface Bundle {
  ik: Uint8Array;
  spkId: number;
  spk: Uint8Array;
  spkSignature: Uint8Array;
  pkId: number;
  pk: Uint8Array;
}

export interface Session {
  rk: Uint8Array;
  dhs: KeyPair;
  dhr?: Uint8Array;
  cks?: Uint8Array;
  ckr?: Uint8Array;
  ns: number;
  nr: number;
  pn: number;
  skipped: Record<string, Uint8Array>;
  ad: Uint8Array;
  peerIk: Uint8Array;
  pendingKex?: { pkId: number; spkId: number; ek: Uint8Array };
  kexEk?: Uint8Array;
}

export function cloneSession(session: Session): Session {
  const skipped: Record<string, Uint8Array> = {};
  for (const id of Object.keys(session.skipped)) {
    skipped[id] = session.skipped[id]!.slice();
  }
  return {
    rk: session.rk.slice(),
    dhs: { priv: session.dhs.priv.slice(), pub: session.dhs.pub.slice() },
    ...(session.dhr ? { dhr: session.dhr.slice() } : {}),
    ...(session.cks ? { cks: session.cks.slice() } : {}),
    ...(session.ckr ? { ckr: session.ckr.slice() } : {}),
    ns: session.ns,
    nr: session.nr,
    pn: session.pn,
    skipped,
    ad: session.ad.slice(),
    peerIk: session.peerIk.slice(),
    ...(session.pendingKex
      ? {
          pendingKex: {
            pkId: session.pendingKex.pkId,
            spkId: session.pendingKex.spkId,
            ek: session.pendingKex.ek.slice(),
          },
        }
      : {}),
    ...(session.kexEk ? { kexEk: session.kexEk.slice() } : {}),
  };
}

function kdfRk(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdfSha256(dhOut, rk, 'OMEMO Root Chain', 64);
  return [out.slice(0, 32), out.slice(32)];
}

function kdfCk(ck: Uint8Array): [Uint8Array, Uint8Array] {
  return [
    hmacSha256(ck, Uint8Array.of(0x02)),
    hmacSha256(ck, Uint8Array.of(0x01)),
  ];
}

function messageKeys(mk: Uint8Array) {
  const km = hkdfSha256(mk, undefined, 'OMEMO Message Key Material', 80);
  return { enc: km.slice(0, 32), auth: km.slice(32, 64), iv: km.slice(64) };
}

function x3dhSecret(...dhs: Uint8Array[]): Uint8Array {
  return hkdfSha256(
    concatBytes(X3DH_PREFIX, ...dhs),
    undefined,
    'OMEMO X3DH',
    32
  );
}

export function initiateSession(own: IdentityKey, bundle: Bundle): Session {
  if (!verify(bundle.spkSignature, bundle.spk, bundle.ik)) {
    throw new Error('Invalid signed prekey signature');
  }
  const ek = generateKeyPair();
  const sk = x3dhSecret(
    dh(identityDhPrivate(own), bundle.spk),
    dh(ek.priv, identityDhPublic(bundle.ik)),
    dh(ek.priv, bundle.spk),
    dh(ek.priv, bundle.pk)
  );

  const dhs = generateKeyPair();
  const [rk, cks] = kdfRk(sk, dh(dhs.priv, bundle.spk));
  return {
    rk,
    dhs,
    dhr: bundle.spk,
    cks,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    ad: concatBytes(own.pub, bundle.ik),
    peerIk: bundle.ik,
    pendingKex: { pkId: bundle.pkId, spkId: bundle.spkId, ek: ek.pub },
  };
}

export function acceptSession(
  own: IdentityKey,
  spk: KeyPair,
  pk: KeyPair,
  peerIk: Uint8Array,
  ek: Uint8Array
): Session {
  const sk = x3dhSecret(
    dh(spk.priv, identityDhPublic(peerIk)),
    dh(identityDhPrivate(own), ek),
    dh(spk.priv, ek),
    dh(pk.priv, ek)
  );
  return {
    rk: sk,
    dhs: spk,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    ad: concatBytes(peerIk, own.pub),
    peerIk,
    kexEk: ek,
  };
}

export function ratchetEncrypt(
  session: Session,
  plaintext: Uint8Array
): [Session, Uint8Array] {
  if (!session.cks) {throw new Error('Session cannot send yet');}
  const s = cloneSession(session);
  const [cks, mk] = kdfCk(s.cks!);
  s.cks = cks;

  const { enc, auth, iv } = messageKeys(mk);
  const message = encodeMessage({
    n: s.ns,
    pn: s.pn,
    dhPub: s.dhs.pub,
    ciphertext: aesEncrypt(enc, iv, plaintext),
  });
  s.ns++;
  const mac = hmacSha256(auth, concatBytes(s.ad, message)).slice(0, 16);
  return [s, encodeAuthenticated({ mac, message })];
}

export function ratchetDecrypt(
  session: Session,
  data: Uint8Array
): [Session, Uint8Array] {
  const { mac, message } = decodeAuthenticated(data);
  const header = decodeMessage(message);
  if (!header.ciphertext) {throw new Error('Message without ciphertext');}
  const s = cloneSession(session);

  const decrypt = (mk: Uint8Array) => {
    const { enc, auth, iv } = messageKeys(mk);
    const expected = hmacSha256(auth, concatBytes(s.ad, message)).slice(0, 16);
    if (!bytesEqual(expected, mac)) {
      throw new Error('Message authentication failed');
    }
    return aesDecrypt(enc, iv, header.ciphertext!);
  };

  const skippedId = `${toBase64(header.dhPub)}:${header.n}`;
  const skippedKey = s.skipped[skippedId];
  if (skippedKey) {
    delete s.skipped[skippedId];
    return [s, decrypt(skippedKey)];
  }

  if (!s.dhr || !bytesEqual(header.dhPub, s.dhr)) {
    skipMessageKeys(s, header.pn);
    s.pn = s.ns;
    s.ns = 0;
    s.nr = 0;
    s.dhr = header.dhPub;
    [s.rk, s.ckr] = kdfRk(s.rk, dh(s.dhs.priv, s.dhr));
    s.dhs = generateKeyPair();
    [s.rk, s.cks] = kdfRk(s.rk, dh(s.dhs.priv, s.dhr));
  }

  skipMessageKeys(s, header.n);
  const [ckr, mk] = kdfCk(s.ckr!);
  s.ckr = ckr;
  s.nr++;
  return [s, decrypt(mk)];
}

function skipMessageKeys(s: Session, until: number) {
  if (!s.ckr || !s.dhr) {return;}
  if (until - s.nr > MAX_SKIP) {throw new Error('Too many skipped messages');}
  const dhr = toBase64(s.dhr);
  while (s.nr < until) {
    const [ckr, mk] = kdfCk(s.ckr);
    s.ckr = ckr;
    s.skipped[`${dhr}:${s.nr}`] = mk;
    s.nr++;
  }
  const ids = Object.keys(s.skipped);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SKIP))) {
    delete s.skipped[id];
  }
}

function payloadKeys(key: Uint8Array) {
  const km = hkdfSha256(key, undefined, 'OMEMO Payload', 80);
  return { enc: km.slice(0, 32), auth: km.slice(32, 64), iv: km.slice(64) };
}

export function encryptPayload(plaintext: Uint8Array): {
  keyMaterial: Uint8Array;
  payload: Uint8Array;
} {
  const key = randomBytes(32);
  const { enc, auth, iv } = payloadKeys(key);
  const payload = aesEncrypt(enc, iv, plaintext);
  const mac = hmacSha256(auth, payload).slice(0, 16);
  return { keyMaterial: concatBytes(key, mac), payload };
}

export function decryptPayload(
  keyMaterial: Uint8Array,
  payload: Uint8Array
): Uint8Array {
  if (keyMaterial.length !== 48) {throw new Error('Invalid key material');}
  const { enc, auth, iv } = payloadKeys(keyMaterial.slice(0, 32));
  const expected = hmacSha256(auth, payload).slice(0, 16);
  if (!bytesEqual(expected, keyMaterial.slice(32))) {
    throw new Error('Payload authentication failed');
  }
  return aesDecrypt(enc, iv, payload);
}
