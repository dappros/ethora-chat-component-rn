// Sealed boxes made by libsodium for known keys, for the Swift check.
import sodium from 'libsodium-wrappers-sumo';
import { createHash } from 'node:crypto';
await sodium.ready;
const b64 = (u) => Buffer.from(u).toString('base64');
const vectors = [];
const messages = ['', 'a', 'hello', 'x'.repeat(15), 'y'.repeat(16), 'z'.repeat(17), 'q'.repeat(1000),
  JSON.stringify({ title: 'Alice', body: 'héllo 👋 — ok', sender: 'Alice', senderJid: 'a@x', chat: 'Team', chatJid: 't@c.x', msgID: '1', image: '' })];
for (const message of messages) {
  const pair = sodium.crypto_box_keypair();
  const sealed = sodium.crypto_box_seal(sodium.from_string(message), pair.publicKey);
  vectors.push({ sk: b64(pair.privateKey), pk: b64(pair.publicKey), sealed: b64(sealed), plaintext: b64(sodium.from_string(message)),
    kid: createHash('sha256').update(Buffer.from(pair.publicKey)).digest('hex').slice(0, 16) });
}
// primitives
const key = sodium.randombytes_buf(32), nonce = sodium.randombytes_buf(24), msg = sodium.randombytes_buf(100);
const box = sodium.crypto_secretbox_easy(msg, nonce, key);
const hs = null;
const bl = sodium.crypto_generichash(24, msg);
const pkey = sodium.randombytes_buf(32);
const auth = sodium.crypto_onetimeauth(msg, pkey);
const out = { vectors, secretbox: { key: b64(key), nonce: b64(nonce), msg: b64(msg), box: b64(box) },
  blake2b24: { msg: b64(msg), out: b64(bl) }, poly1305: { key: b64(pkey), msg: b64(msg), out: b64(auth) } };
process.stdout.write(JSON.stringify(out));
