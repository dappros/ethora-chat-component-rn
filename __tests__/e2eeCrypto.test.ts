/**
 * E2EE, phase 1 - the OMEMO 2 crypto core (src/e2ee/crypto, protobuf,
 * ratchet), ported from the web SDK.
 *
 * Three kinds of evidence, because a port that only agrees with itself
 * proves nothing:
 *   - published vectors (RFC 7748, 8032, 5869, NIST SP 800-38A) for the
 *     primitives as this runtime computes them;
 *   - a transcript produced by the web implementation
 *     (fixtures/omemoWebTranscript.json), which this code has to read;
 *   - the protocol's own rules: out-of-order delivery, tampering, replay.
 */

import {
  aesDecrypt,
  aesEncrypt,
  bytesEqual,
  dh,
  fromBase64,
  generateIdentity,
  generateKeyPair,
  hkdfSha256,
  identityDhPrivate,
  identityDhPublic,
  randomInt,
  sign,
  toBase64,
  toHex,
  verify,
} from '../src/e2ee/crypto';
import {
  decodeAuthenticated,
  decodeKeyExchange,
  decodeMessage,
  encodeAuthenticated,
  encodeKeyExchange,
  encodeMessage,
} from '../src/e2ee/protobuf';
import {
  acceptSession,
  cloneSession,
  decryptPayload,
  encryptPayload,
  initiateSession,
  ratchetDecrypt,
  ratchetEncrypt,
  type Bundle,
  type Session,
} from '../src/e2ee/ratchet';

const fixture = require('./fixtures/omemoWebTranscript.json');

const hex = (text: string) =>
  Uint8Array.from(text.match(/../g) || [], (byte) => parseInt(byte, 16));
const utf8 = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

describe('primitives against published vectors', () => {
  it('X25519 (RFC 7748 §6.1)', () => {
    const alicePriv = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bobPub = hex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
    expect(toHex(dh(alicePriv, bobPub))).toBe(
      '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
    );
  });

  it('Ed25519 (RFC 8032 §7.1, test 1)', () => {
    const identity = {
      seed: hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'),
      pub: hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
    };
    const signature = sign(identity, new Uint8Array(0));
    expect(toHex(signature)).toBe(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
        '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
    );
    expect(verify(signature, new Uint8Array(0), identity.pub)).toBe(true);
    expect(verify(signature, Uint8Array.of(1), identity.pub)).toBe(false);
    // A malformed key is a failed check, not an exception.
    expect(verify(signature, new Uint8Array(0), new Uint8Array(5))).toBe(false);
  });

  it('HKDF-SHA-256 (RFC 5869, test case 3: no salt, no info)', () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    expect(toHex(hkdfSha256(ikm, undefined, '', 42))).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d' +
        '9d201395faa4b61a96c8'
    );
  });

  it('AES-256-CBC (NIST SP 800-38A F.2.5), PKCS#7 padded', () => {
    const key = hex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4');
    const iv = hex('000102030405060708090a0b0c0d0e0f');
    const block = hex('6bc1bee22e409f96e93d7e117393172a');
    const out = aesEncrypt(key, iv, block);
    expect(out.length).toBe(32);
    expect(toHex(out.slice(0, 16))).toBe('f58c4c04d6e5f1ba779eabfb5f7bfbd6');
    expect(toHex(aesDecrypt(key, iv, out))).toBe(toHex(block));
  });
});

describe('helpers', () => {
  it('base64 matches the platform codec for every length', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const encoded = toBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(toHex(fromBase64(encoded))).toBe(toHex(bytes));
    }
  });

  it('base64 decoding tolerates whitespace and missing padding, nothing else', () => {
    expect(text(fromBase64('aGVs\nbG8g d29y\tbGQ='))).toBe('hello world');
    expect(text(fromBase64('aGVsbG8gd29ybGQ'))).toBe('hello world');
    expect(() => fromBase64('aGVs*G8=')).toThrow('Invalid base64');
    expect(() => fromBase64('a')).toThrow('Invalid base64');
    expect(() => fromBase64('aGVsbé')).toThrow('Invalid base64');
  });

  it('bytesEqual compares content', () => {
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1))).toBe(false);
  });

  it('randomInt stays inside its bounds', () => {
    for (let i = 0; i < 200; i++) {
      const n = randomInt(1, 100);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(100);
    }
    expect(randomInt(5, 5)).toBe(5);
  });

  it('an identity key agrees with its X25519 form on both sides', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(toHex(dh(identityDhPrivate(a), identityDhPublic(b.pub)))).toBe(
      toHex(dh(identityDhPrivate(b), identityDhPublic(a.pub)))
    );
  });
});

describe('protobuf codec', () => {
  it('encodes OMEMOMessage as the schema says', () => {
    // n=1, pn=300, dh_pub=0xAA 0xBB, ciphertext=0x01
    const encoded = encodeMessage({
      n: 1,
      pn: 300,
      dhPub: Uint8Array.of(0xaa, 0xbb),
      ciphertext: Uint8Array.of(1),
    });
    expect(toHex(encoded)).toBe('080110ac021a02aabb220101');
    expect(decodeMessage(encoded)).toEqual({
      n: 1,
      pn: 300,
      dhPub: Uint8Array.of(0xaa, 0xbb),
      ciphertext: Uint8Array.of(1),
    });
  });

  it('round-trips the wrappers, with the full uint32 range', () => {
    const auth = { mac: new Uint8Array(16).fill(7), message: Uint8Array.of(1, 2, 3) };
    expect(decodeAuthenticated(encodeAuthenticated(auth))).toEqual(auth);

    const kex = {
      pkId: 0xffffffff,
      spkId: 0,
      ik: new Uint8Array(32).fill(1),
      ek: new Uint8Array(32).fill(2),
      message: Uint8Array.of(9),
    };
    expect(decodeKeyExchange(encodeKeyExchange(kex))).toEqual(kex);
    expect(() => encodeKeyExchange({ ...kex, pkId: -1 })).toThrow('Invalid uint32');
    expect(() => encodeKeyExchange({ ...kex, pkId: 2 ** 32 })).toThrow('Invalid uint32');
  });

  it('skips unknown fields and rejects what is missing or cut short', () => {
    // field 9 (varint) and field 10 (fixed32) around a valid message
    const padded = Uint8Array.from([
      0x48, 0x05, ...encodeMessage({ n: 2, pn: 3, dhPub: Uint8Array.of(4) }),
      0x55, 1, 2, 3, 4,
    ]);
    expect(decodeMessage(padded)).toEqual({
      n: 2,
      pn: 3,
      dhPub: Uint8Array.of(4),
      ciphertext: undefined,
    });

    expect(() => decodeMessage(Uint8Array.of(0x08, 0x01))).toThrow('Missing field');
    expect(() => decodeMessage(Uint8Array.of(0x1a, 0x05, 1))).toThrow('Truncated field');
    expect(() => decodeMessage(Uint8Array.of(0x08))).toThrow('Truncated varint');
  });

  it('copies decoded bytes out of the input buffer', () => {
    const encoded = encodeAuthenticated({ mac: Uint8Array.of(1), message: Uint8Array.of(2) });
    const decoded = decodeAuthenticated(encoded);
    encoded.fill(0);
    expect(decoded.mac[0]).toBe(1);
  });
});

const sessionFromFixture = (raw: any): Session => ({
  rk: fromBase64(raw.rk),
  dhs: { priv: fromBase64(raw.dhs.priv), pub: fromBase64(raw.dhs.pub) },
  ...(raw.dhr ? { dhr: fromBase64(raw.dhr) } : {}),
  ...(raw.cks ? { cks: fromBase64(raw.cks) } : {}),
  ...(raw.ckr ? { ckr: fromBase64(raw.ckr) } : {}),
  ns: raw.ns,
  nr: raw.nr,
  pn: raw.pn,
  skipped: Object.fromEntries(
    Object.entries(raw.skipped as Record<string, string>).map(([id, key]) => [
      id,
      fromBase64(key),
    ])
  ),
  ad: fromBase64(raw.ad),
  peerIk: fromBase64(raw.peerIk),
  ...(raw.pendingKex
    ? { pendingKex: { ...raw.pendingKex, ek: fromBase64(raw.pendingKex.ek) } }
    : {}),
});

describe('a transcript written by the web SDK', () => {
  const bob = {
    identity: {
      seed: fromBase64(fixture.bob.identity.seed),
      pub: fromBase64(fixture.bob.identity.pub),
    },
    spk: { priv: fromBase64(fixture.bob.spk.priv), pub: fromBase64(fixture.bob.spk.pub) },
    pk: { priv: fromBase64(fixture.bob.pk.priv), pub: fromBase64(fixture.bob.pk.pub) },
  };

  it('is read by the receiving side, key exchange included', () => {
    const kex = decodeKeyExchange(fromBase64(fixture.keyExchange));
    expect(kex.pkId).toBe(fixture.bob.pk.id);
    expect(kex.spkId).toBe(fixture.bob.spk.id);
    expect(toBase64(kex.ik)).toBe(fixture.alice.identityPub);

    let session = acceptSession(bob.identity, bob.spk, bob.pk, kex.ik, kex.ek);
    let plain: Uint8Array;
    [session, plain] = ratchetDecrypt(session, kex.message);
    expect(text(plain)).toBe(fixture.fromAlice[0].text);
    [session, plain] = ratchetDecrypt(session, fromBase64(fixture.fromAlice[1].data));
    expect(text(plain)).toBe(fixture.fromAlice[1].text);

    // Alice's third and fourth follow a ratchet step that answered Bob's
    // replies; to read them Bob has to have sent those replies himself,
    // which only the web run did. What this side can assert is that they
    // do not open with the wrong chain.
    expect(() =>
      ratchetDecrypt(session, fromBase64(fixture.fromAlice[2].data))
    ).toThrow();
  });

  it('is read by the initiating side across a ratchet step', () => {
    let session = sessionFromFixture(fixture.alice.sessionBeforeReplies);
    let plain: Uint8Array;
    // Second reply first: its key is derived by skipping over the first.
    [session, plain] = ratchetDecrypt(session, fromBase64(fixture.fromBob[1].data));
    expect(text(plain)).toBe(fixture.fromBob[1].text);
    expect(Object.keys(session.skipped)).toHaveLength(1);
    [session, plain] = ratchetDecrypt(session, fromBase64(fixture.fromBob[0].data));
    expect(text(plain)).toBe(fixture.fromBob[0].text);
    expect(Object.keys(session.skipped)).toHaveLength(0);
  });

  it('has a payload this side can open', () => {
    const opened = decryptPayload(
      fromBase64(fixture.payload.keyMaterial),
      fromBase64(fixture.payload.payload)
    );
    expect(text(opened)).toBe(fixture.payload.text);
  });

  it('carries a signed prekey signature this side accepts', () => {
    expect(
      verify(fromBase64(fixture.bob.spk.signature), bob.spk.pub, bob.identity.pub)
    ).toBe(true);
  });
});

describe('sessions', () => {
  const makeBob = () => {
    const identity = generateIdentity();
    const spk = generateKeyPair();
    const pk = generateKeyPair();
    const bundle: Bundle = {
      ik: identity.pub,
      spkId: 1,
      spk: spk.pub,
      spkSignature: sign(identity, spk.pub),
      pkId: 2,
      pk: pk.pub,
    };
    return { identity, spk, pk, bundle };
  };

  const pair = () => {
    const bob = makeBob();
    const aliceIdentity = generateIdentity();
    const alice = initiateSession(aliceIdentity, bob.bundle);
    const bobSession = acceptSession(
      bob.identity,
      bob.spk,
      bob.pk,
      aliceIdentity.pub,
      alice.pendingKex!.ek
    );
    return { alice, bob: bobSession };
  };

  it('refuses a bundle whose signed prekey is not signed by its identity', () => {
    const bob = makeBob();
    const forged = { ...bob.bundle, spk: generateKeyPair().pub };
    expect(() => initiateSession(generateIdentity(), forged)).toThrow(
      'Invalid signed prekey signature'
    );
  });

  it('carry a conversation both ways, in and out of order', () => {
    let { alice, bob } = pair();
    let wire: Uint8Array;
    let plain: Uint8Array;

    // The responder cannot send until it has received something.
    expect(() => ratchetEncrypt(bob, utf8('too early'))).toThrow('Session cannot send yet');

    [alice, wire] = ratchetEncrypt(alice, utf8('one'));
    [bob, plain] = ratchetDecrypt(bob, wire);
    expect(text(plain)).toBe('one');

    const replies: Uint8Array[] = [];
    for (const reply of ['r0', 'r1', 'r2']) {
      [bob, wire] = ratchetEncrypt(bob, utf8(reply));
      replies.push(wire);
    }
    for (const index of [2, 0, 1]) {
      [alice, plain] = ratchetDecrypt(alice, replies[index]!);
      expect(text(plain)).toBe(`r${index}`);
    }

    for (let round = 0; round < 5; round++) {
      [alice, wire] = ratchetEncrypt(alice, utf8(`a${round} привет 🔐`));
      [bob, plain] = ratchetDecrypt(bob, wire);
      expect(text(plain)).toBe(`a${round} привет 🔐`);
      [bob, wire] = ratchetEncrypt(bob, utf8(`b${round}`));
      [alice, plain] = ratchetDecrypt(alice, wire);
      expect(text(plain)).toBe(`b${round}`);
    }
  });

  it('leave the input session untouched, so a failed message costs nothing', () => {
    let { alice, bob } = pair();
    let wire: Uint8Array;
    [alice, wire] = ratchetEncrypt(alice, utf8('kept'));

    const before = JSON.stringify(cloneSession(bob), (_, v) =>
      v instanceof Uint8Array ? toHex(v) : v
    );
    const tampered = wire.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(() => ratchetDecrypt(bob, tampered)).toThrow();
    expect(
      JSON.stringify(bob, (_, v) => (v instanceof Uint8Array ? toHex(v) : v))
    ).toBe(before);

    // The untouched session still reads the real message...
    const [advanced, plain] = ratchetDecrypt(bob, wire);
    expect(text(plain)).toBe('kept');
    // ...and the advanced one refuses to read it a second time.
    expect(() => ratchetDecrypt(advanced, wire)).toThrow();
  });

  it('refuse to skip more than a thousand messages in one chain', () => {
    let { alice, bob } = pair();
    let wire: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < 1002; i++) {
      [alice, wire] = ratchetEncrypt(alice, utf8('x'));
    }
    expect(() => ratchetDecrypt(bob, wire)).toThrow('Too many skipped messages');
  });

  it('are copied without sharing anything', () => {
    const { alice } = pair();
    const copy = cloneSession(alice);
    expect(copy).toEqual(alice);
    copy.rk[0] ^= 0xff;
    copy.dhs.priv[0] ^= 0xff;
    copy.pendingKex!.ek[0] ^= 0xff;
    copy.skipped.x = Uint8Array.of(1);
    expect(copy.rk[0]).not.toBe(alice.rk[0]);
    expect(copy.dhs.priv[0]).not.toBe(alice.dhs.priv[0]);
    expect(copy.pendingKex!.ek[0]).not.toBe(alice.pendingKex!.ek[0]);
    expect(alice.skipped.x).toBeUndefined();
  });
});

describe('message payload', () => {
  it('round-trips and is keyed by 48 bytes of key material', () => {
    const sealed = encryptPayload(utf8('<envelope/>'));
    expect(sealed.keyMaterial).toHaveLength(48);
    expect(text(decryptPayload(sealed.keyMaterial, sealed.payload))).toBe('<envelope/>');
  });

  it('rejects a modified payload, a modified tag and short key material', () => {
    const sealed = encryptPayload(utf8('<envelope/>'));
    const payload = sealed.payload.slice();
    payload[0] ^= 1;
    expect(() => decryptPayload(sealed.keyMaterial, payload)).toThrow(
      'Payload authentication failed'
    );
    const keyMaterial = sealed.keyMaterial.slice();
    keyMaterial[47] ^= 1;
    expect(() => decryptPayload(keyMaterial, sealed.payload)).toThrow(
      'Payload authentication failed'
    );
    expect(() => decryptPayload(sealed.keyMaterial.slice(0, 32), sealed.payload)).toThrow(
      'Invalid key material'
    );
  });
});
