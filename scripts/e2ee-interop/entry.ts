// Runs this SDK's OMEMO code against the web SDK's, in one process.
//
// A port that only agrees with itself proves nothing, and the two clients
// have to read each other's messages in real rooms. This is bundled and
// run by ../e2ee-interop.mjs, which points `@web/*` at the web SDK's
// src/e2ee and `@rn/*` at ours.

import { xml } from '@xmpp/client';
import { parse } from 'ltx';

import * as webC from '@web/crypto';
import * as webR from '@web/ratchet';
import * as webP from '@web/protobuf';
import * as webF from '@web/fileEnvelope';
import { Omemo as WebOmemo } from '@web/omemo';
import { createMemoryStore as webStore } from '@web/store';

import * as rnC from '@rn/crypto';
import * as rnR from '@rn/ratchet';
import * as rnP from '@rn/protobuf';
import * as rnF from '@rn/fileEnvelope';
import { Omemo as RnOmemo } from '@rn/omemo';
import { createMemoryStore as rnStore } from '@rn/store';

const assert = (ok: unknown, what: string) => {
  if (!ok) {throw new Error(`FAILED: ${what}`);}
};
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// -- 1. Sessions: X3DH and the double ratchet --------------------------------

type Impl = { C: typeof webC; R: typeof webR; P: typeof webP; name: string };
const WEB: Impl = { C: webC, R: webR, P: webP, name: 'web' };
const RN: Impl = { C: rnC as any, R: rnR as any, P: rnP as any, name: 'rn' };

function converse(A: Impl, B: Impl) {
  const identity = B.C.generateIdentity();
  const spk = B.C.generateKeyPair();
  const pk = B.C.generateKeyPair();
  const bundle = { ik: identity.pub, spkId: 7, spk: spk.pub, spkSignature: B.C.sign(identity, spk.pub), pkId: 42, pk: pk.pub };

  const aliceId = A.C.generateIdentity();
  let a = A.R.initiateSession(aliceId, bundle as any);
  const kex = a.pendingKex!;
  let m1: Uint8Array;
  let m2: Uint8Array;
  [a, m1] = A.R.ratchetEncrypt(a, enc('hello bob'));
  [a, m2] = A.R.ratchetEncrypt(a, enc('second, before any reply'));
  const kexBytes = A.P.encodeKeyExchange({ pkId: kex.pkId, spkId: kex.spkId, ik: aliceId.pub, ek: kex.ek, message: m1 });

  const parsed = B.P.decodeKeyExchange(kexBytes);
  let b = B.R.acceptSession(identity, spk, pk, parsed.ik, parsed.ek);
  let out: Uint8Array;
  [b, out] = B.R.ratchetDecrypt(b, parsed.message);
  assert(dec(out) === 'hello bob', `${A.name}->${B.name} first message`);
  [b, out] = B.R.ratchetDecrypt(b, m2);
  assert(dec(out) === 'second, before any reply', `${A.name}->${B.name} second message`);

  // Replies delivered out of order.
  const replies: Uint8Array[] = [];
  for (const text of ['r0', 'r1', 'r2']) {
    let r: Uint8Array;
    [b, r] = B.R.ratchetEncrypt(b, enc(text));
    replies.push(r);
  }
  for (const i of [2, 0, 1]) {
    [a, out] = A.R.ratchetDecrypt(a, replies[i]!);
    assert(dec(out) === `r${i}`, `${B.name}->${A.name} reply ${i} out of order`);
  }

  for (let round = 0; round < 6; round++) {
    let m: Uint8Array;
    [a, m] = A.R.ratchetEncrypt(a, enc(`a${round} привет 🔐`));
    [b, out] = B.R.ratchetDecrypt(b, m);
    assert(dec(out) === `a${round} привет 🔐`, `round ${round} ${A.name}->${B.name}`);
    [b, m] = B.R.ratchetEncrypt(b, enc(`b${round}`));
    [a, out] = A.R.ratchetDecrypt(a, m);
    assert(dec(out) === `b${round}`, `round ${round} ${B.name}->${A.name}`);
  }

  let tampered: Uint8Array;
  [a, tampered] = A.R.ratchetEncrypt(a, enc('x'));
  tampered = tampered.slice();
  tampered[tampered.length - 1] ^= 1;
  let threw = false;
  try {
    B.R.ratchetDecrypt(b, tampered);
  } catch {
    threw = true;
  }
  assert(threw, 'a tampered message is rejected');

  const sealed = A.R.encryptPayload(enc('<envelope/>'));
  assert(dec(B.R.decryptPayload(sealed.keyMaterial, sealed.payload)) === '<envelope/>', 'payload');
}

for (const [A, B] of [[WEB, RN], [RN, WEB]] as const) {
  for (let i = 0; i < 5; i++) {converse(A, B);}
  console.log(`ok  sessions      initiator=${A.name} responder=${B.name}`);
}

{
  const key = webC.randomBytes(32);
  const iv = webC.randomBytes(16);
  const data = webC.randomBytes(1000);
  assert(hex(webC.aesEncrypt(key, iv, data)) === hex(rnC.aesEncrypt(key, iv, data)), 'aes');
  assert(hex(webC.hkdfSha256(key, undefined, 'OMEMO X3DH', 80)) === hex(rnC.hkdfSha256(key, undefined, 'OMEMO X3DH', 80)), 'hkdf');
  for (let n = 0; n < 70; n++) {
    const bytes = webC.randomBytes(n);
    assert(webC.toBase64(bytes) === rnC.toBase64(bytes), `base64 encode ${n}`);
    assert(hex(rnC.fromBase64(webC.toBase64(bytes))) === hex(bytes), `base64 decode ${n}`);
  }
  const id = webC.generateIdentity();
  assert(hex(webC.identityDhPrivate(id)) === hex(rnC.identityDhPrivate(id)), 'identity -> x25519 private');
  assert(hex(webC.identityDhPublic(id.pub)) === hex(rnC.identityDhPublic(id.pub)), 'identity -> x25519 public');
  console.log('ok  primitives    byte-identical on shared inputs');
}

// -- 2. Messages in rooms: the Omemo classes over a shared PEP ---------------

const DOMAIN = 'localhost';
const ROOM = 'room1@conference.localhost';
type Pep = Map<string, Map<string, Map<string, any>>>;

function fakeClient(pep: Pep, jid: string) {
  const sent: any[] = [];
  const nodesOf = (owner: string) => {
    let nodes = pep.get(owner);
    if (!nodes) {pep.set(owner, (nodes = new Map()));}
    return nodes;
  };
  return {
    sent,
    jid: { bare: () => ({ toString: () => jid }), getDomain: () => jid.split('@')[1], getLocal: () => jid.split('@')[0], toString: () => jid },
    send: async (stanza: any) => void sent.push(stanza),
    iqCaller: {
      request: async (iq: any) => {
        const pubsub = iq.getChild('pubsub');
        const publish = pubsub.getChild('publish');
        if (publish) {
          const node = nodesOf(jid);
          const item = publish.getChild('item');
          let items = node.get(publish.attrs.node);
          if (!items) {node.set(publish.attrs.node, (items = new Map()));}
          items.set(item.attrs.id, item.children[0]);
          return xml('iq', { type: 'result' });
        }
        const query = pubsub.getChild('items');
        const stored = nodesOf(String(iq.attrs.to)).get(query.attrs.node) ?? new Map();
        const wanted = query.getChild('item')?.attrs.id;
        const items = [...stored.entries()]
          .filter(([id]) => !wanted || id === wanted)
          .map(([id, payload]) => xml('item', { id }, payload));
        return xml('iq', { type: 'result' }, xml('pubsub', { xmlns: 'http://jabber.org/protocol/pubsub' }, xml('items', { node: query.attrs.node }, ...items)));
      },
    },
  };
}

// What a server does to a stanza: nothing survives by reference.
const wire = (stanza: any) => parse(stanza.toString());
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Kind = 'web' | 'rn';
const device = async (kind: Kind, pep: Pep, jid: string) => {
  const client = fakeClient(pep, jid);
  const o: any =
    kind === 'web'
      ? await WebOmemo.create(client as never, jid, webStore())
      : await RnOmemo.create(client as never, jid, rnStore(), { label: 'iOS' });
  return { o, client, jid, kind };
};

const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

for (const kinds of [['web', 'rn'], ['rn', 'web'], ['rn', 'web', 'web'], ['web', 'rn', 'rn']] as Kind[][]) {
  const pep: Pep = new Map();
  const members = [] as Awaited<ReturnType<typeof device>>[];
  for (let i = 0; i < kinds.length; i++) {members.push(await device(kinds[i]!, pep, `user${i}@${DOMAIN}`));}
  const jids = members.map((m) => m.jid);
  let n = 0;

  const say = async (from: number, text: string) => {
    const id = `m-${++n}`;
    const stanza = wire(await members[from]!.o.encryptGroupMessage(ROOM, jids, [xml('body', {}, text)], id, [xml('data', { senderFirstName: 'X' })]));
    for (let i = 0; i < members.length; i++) {
      const got = await members[i]!.o.decrypt(wire(stanza), members[from]!.jid, ROOM);
      assert(!got.error, `${kinds[from]}#${from} -> ${kinds[i]}#${i}: ${got.error}`);
      assert(parse(`<x>${got.content}</x>`).getChildText('body') === text, `${kinds[from]}#${from} -> ${kinds[i]}#${i}: text`);
      assert(got.trust === (i === from ? 'own' : 'blind'), `trust of ${kinds[i]}#${i}`);
    }
    await settle();
    // The session-completing empty messages go direct, not through the room.
    for (const m of members) {
      for (const s of m.client.sent.splice(0)) {
        await members.find((x) => x.jid === s.attrs.to)!.o.decrypt(wire(s), m.jid, ROOM);
      }
    }
    return stanza;
  };

  await quiet(async () => {
    for (let round = 0; round < 3; round++) {
      for (let from = 0; from < kinds.length; from++) {await say(from, `r${round} from ${from}: привет 🔐 <b>&`);}
    }
    const last = await say(0, 'steady state');
    const repeated = last
      .getChild('encrypted')
      .getChild('header')
      .getChildren('keys')
      .flatMap((k: any) => k.getChildren('key'))
      .filter((k: any) => k.attrs.kex);
    assert(repeated.length === 0, 'key exchange settled');
  });
  console.log(`ok  room          [${kinds.join(', ')}]: everyone writes, everyone reads`);
}

await quiet(async () => {
  const pep: Pep = new Map();
  const web = await device('web', pep, `a@${DOMAIN}`);
  const rn = await device('rn', pep, `a@${DOMAIN}`);
  const other = await device('rn', pep, `b@${DOMAIN}`);
  const toBoth = wire(await other.o.encryptGroupMessage(ROOM, [web.jid, other.jid], [xml('body', {}, 'to both')], 'x-1', []));
  for (const d of [web, rn]) {
    assert((await d.o.decrypt(wire(toBoth), other.jid, ROOM)).content?.includes('to both'), `two devices: ${d.kind}`);
  }
  const fromWeb = wire(await web.o.encryptGroupMessage(ROOM, [web.jid, other.jid], [xml('body', {}, 'from web')], 'x-2', []));
  assert((await rn.o.decrypt(wire(fromWeb), web.jid, ROOM)).content?.includes('from web'), 'own rn device reads own web device');
  const fromRn = wire(await rn.o.encryptGroupMessage(ROOM, [web.jid, other.jid], [xml('body', {}, 'from rn')], 'x-3', []));
  assert((await web.o.decrypt(wire(fromRn), rn.jid, ROOM)).content?.includes('from rn'), 'own web device reads own rn device');
  // The labels each side announced, as the other side lists them.
  const labels = (await rn.o.devices(web.jid)).map((d: any) => d.label).sort();
  assert(labels.join(',') === 'Web,iOS', `labels: ${labels}`);
});
console.log('ok  one account   web device + rn device, both read and write');

// -- 3. Sealed attachments ----------------------------------------------------

for (const size of [0, 1, 16, 5000, 32768, 32769, 100000, 1_300_000]) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 7 + 3) & 0xff);
  const name = 'звіт final 🔐.pdf';
  const type = 'application/pdf';
  const fromWeb = await webF.sealFileForUpload(new File([bytes], name, { type }));
  const a = await rnF.openSealedFile(fromWeb.ciphertext, fromWeb.keyMaterial);
  assert(hex(a.bytes) === hex(bytes) && a.meta.originalname === name && a.meta.mimetype === type && a.meta.size === size, `file web->rn ${size}`);
  const fromRn = await rnF.sealFileForUpload({ bytes, name, type });
  const b = webF.openSealedFile(fromRn.ciphertext, fromRn.keyMaterial);
  assert(hex(b.bytes) === hex(bytes) && b.meta.originalname === name && b.meta.mimetype === type && b.meta.size === size, `file rn->web ${size}`);
}
assert(
  JSON.stringify(rnF.parseSealedMediaBody('{"v":1,"keys":["k"]}')) === JSON.stringify(webF.parseSealedMediaBody('{"v":1,"keys":["k"]}')),
  'sealed media body'
);
console.log('ok  attachments   sealed by one, opened by the other, 8 sizes');
console.log('\nweb SDK and this SDK interoperate.');
