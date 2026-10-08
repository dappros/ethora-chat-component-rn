# E2EE port (OMEMO 2) — status and measurements

The web SDK (`ethora-chat-component`, `src/e2ee`) runs OMEMO 2 in rooms the
backend marks `e2ee`. This document tracks bringing the same thing to this
SDK, file for file, so the two stay wire-compatible.

## Phases

| # | What | State |
| --- | --- | --- |
| 0 | Present encrypted rooms honestly: padlocks, placeholder for unreadable payloads, sealed-file card, no plaintext sends | done |
| 1 | Crypto core: `crypto.ts`, `protobuf.ts`, `ratchet.ts` | done, not wired in |
| 2 | Key store (encrypted MMKV) and the `Omemo` class: device list and bundle on PEP | done, behind `config.e2ee.enabled` |
| 3 | Receive: decrypt at the `handleStanza` seam (`e2ee/stanza.ts`) | done; live check against a web client pending |
| 4 | Send: encrypt in the text send path; lift `canSendToRoom` | done; live check against a web client pending |
| 5 | Sealed attachments (`fileEnvelope.ts`) | done, pure JS with a size cap; live check against a web client pending |
| 6 | Devices, fingerprints and trust; no corrections in clear; repeatable web ↔ RN interop check | done |

What is encrypted is a message's text and its attachments. Deletions and
reactions travel in clear on both clients. So do edits and the quoted text
of a reply - see "What is still in clear" below.

## Phase 1: what was checked

- Published vectors (RFC 7748, RFC 8032, RFC 5869, NIST SP 800-38A) — in
  Jest and, as a self-test, on Hermes inside the app.
- A transcript produced by the web implementation
  (`__tests__/fixtures/omemoWebTranscript.json`) is read by this code:
  key exchange, both directions, a ratchet step, out-of-order delivery,
  the message payload.
- Both implementations bundled into one Node script and run against each
  other, every pairing of initiator and responder, 5 conversations each
  with replies, 6 ratchet round trips, out-of-order delivery and a tampered
  message; primitives compared byte for byte on shared inputs. One-off, not
  in CI (it needs the web repository next to this one).

Differences from the web source, all forced by the runtime: `cloneSession`
instead of `structuredClone`, and base64 without `btoa`/`atob`. Both exist
on the Hermes that ships with RN 0.86, but not on the older ones this SDK
still supports.

## Phase 2: what was checked

- The web SDK's MUC round-trip tests, ported with the class
  (`__tests__/e2eeOmemo.test.ts`), plus the device store, the start-up glue,
  key-exchange completion and reconnects.
- The web `Omemo` class against this one over a shared in-memory PEP, as a
  Node script: rooms of `[web, rn]`, `[rn, web]`, `[rn, web, web]`,
  `[web, rn, rn]`, `[rn, rn]`, three rounds each with every member writing
  and every member reading, key exchange settling, and one account with a
  web and an RN device both reading and writing. One-off, not in CI.
- The QA server (`xmpp.chat-qa.ethora.com`), from the app on the iOS
  simulator: bundle with 100 prekeys and the device-list entry published
  and read back, next to the account's three existing web devices, whose
  bundles were read too. First start 2.3 s including key generation; later
  starts 0.45 s. The same device after an app restart.

That last check failed the first time, and is why the device store refuses
a key it cannot prove is kept. The MMKV key was stored under a name
expo-secure-store rejects; the write failed silently, every launch got a new
key, and so a new device. Mocks that accept any key name and ignore the
encryption key cannot see that - both mocks now behave like the real thing.
The same mistake was in the chat cache's MMKV backend since 26.8.6 and is
fixed with it (see the changelog).

## Phases 3-4: how they differ from the web, and why

The web SDK decrypts in two places (live traffic, and archive pages that
never reach `handleStanza`). Here every message arrives through
`handleStanza`, so there is one seam - and an ordered queue behind it,
because the archive router and the edit/reaction handlers depend on the
order stanzas arrive in.

The web waits for the publish before the device can read. Here it reads as
soon as the keys are loaded (`Omemo.open`): the archive starts arriving the
moment the stream is up, and on a phone two IQ round trips on every launch
are not free. A message waits at most 8 s for the keys (generating them
takes a few seconds, once); past that it is shown as unreadable rather than
hold up everything behind it.

The web sends in clear on any encryption failure. Here too, with one
exception: when the room's members are not known (the roster is not
persisted, so a room restored from the cache has none until `/chats/my`
returns) they are fetched, and if that fails nothing is sent. An empty list
would address the message to our own devices only.

Checked: Jest against a fake PEP with the web SDK's own test cases; the
start-up and ordinary rooms on the QA server with the flag on (40 rooms, all
histories loaded, nothing held up). **Not checked: an encrypted exchange
with a live web client** - the test account has no `e2ee` room yet.

## Phase 5: sealed attachments

The envelope and the wire format are the web SDK's. The cipher is the same
construction as the message payload, run in 32 KB slices with a yield
between them (`fileCipher.ts`), since one blocking call per megabyte would
freeze the app. Checked: against `encryptPayload` / `decryptPayload` around
every slice boundary; against the web's `sealFileForUpload` /
`openSealedFile` in both directions, eight sizes up to 1.3 MB (one-off Node
script); and on the simulator's real file system - read, seal, park, open,
keep, find again, clear:

| File | Seal | Open | Longest pause of the JS thread |
| --- | --- | --- | --- |
| 0.3 MB | 0.44 s | 0.43 s | 55 ms |
| 1 MB | 1.4 s | 1.4 s | 50 ms |
| 3 MB | 4.2 s | 4.4 s | 124 ms |

(iPhone 17 Pro Max simulator, dev bundle; a phone is slower, a release
bundle faster.) So a compressed photo costs a second or two and the UI keeps
moving, and a long video is out of reach: sealing is capped at 20 MB and the
composer says so when the file is picked. The file is in memory about three
times over while it is sealed.

Lifting that needs native AES and SHA-256. `react-native-quick-crypto`
mirrors Node's `createCipheriv` / `createHmac`, so a second backend behind
`encryptLargePayload` / `decryptLargePayload` is a small change - but it is a
native module: it has to be added to the host app and the app rebuilt, which
is the host's call. Not done.

Unlike text, an attachment has no clear-text fallback: without somebody to
encrypt the key for, nothing is sent.

Opened attachments are plaintext in the app's cache (`ethora-sealed/`),
kept so they open at once the next time, and removed on logout. The web
client keeps nothing and downloads to the user's disk instead.

## Phase 6: devices and trust, and checking against the web

`npm run e2ee:interop` (`scripts/e2ee-interop.mjs`) bundles this SDK's
`src/e2ee` and the web SDK's into one Node process and runs them against
each other: sessions with either side initiating, out-of-order delivery,
ratchet steps and tampering; the `Omemo` classes over a shared PEP in rooms
of `[web, rn]`, `[rn, web]`, `[rn, web, web]` and `[web, rn, rn]`; one
account on a web and a mobile device; attachments sealed by one side and
opened by the other. It needs the web SDK checked out next to this
repository (or `WEB_SDK=…`) and skips otherwise. Run it after touching
either side's `e2ee` folder.

Against the QA server, from the app (2026-10-05): an `e2ee` private room
created from the profile action; text in both directions with a web peer -
neither message carrying the "not encrypted" mark nor a placeholder; a
sealed attachment sent from the phone, echoed back and read with its key,
then downloaded from the files host and opened again (a 3 KB PDF, 0.7 s);
the account's own device list (three web devices and this one) and the
peer's, with labels.

Trust follows the web SDK's rule (blind trust before verification): a device
is trusted on first sight until one of that person's devices has been marked
verified; after that a device nobody verified is not encrypted for. The
card in Settings shows this account's devices, the one on a profile that
person's.

## What is still in clear

- **Edits.** A correction stanza carries the new text in clear, on both
  clients. This SDK no longer offers to edit a message that went out
  encrypted; the web SDK still does, and an edit made there is shown here.
- **The quoted text of a reply.** `mainMessage` on `<data>` carries the text
  of the message being replied to, in clear, on both clients - so replying
  to an encrypted message publishes it. Not changed here: leaving the text
  out on one side alone makes the quote come up empty on the other. The fix
  is for both clients to send the reference without the text and look the
  message up locally.
- Who wrote to which room and when, deletions, reactions, and the fact that
  an attachment exists and how large it is.

## Known gaps

- Attachments over 20 MB cannot be sealed on the device (pure-JS cipher).
- A sealed attachment has no thumbnail, duration or waveform before it is
  opened - the server never sees the file to make them - and nothing is
  opened automatically.
- A message that timed out waiting for the keys stays a placeholder in the
  cache; it is not retried when the keys arrive.
- The device's cache of decrypted messages (`message:<room>:<id>`, needed
  because a message key works once) grows without bound, as on the web.
- A session-completing empty message is dropped by the receiver (here and on
  the web), so the key exchange is repeated until the peer writes something.
- Nothing removes a device from an account's list: one that is no longer
  used stays there, and keeps being encrypted for.

## Phase 1: Hermes measurements

iPhone 17 Pro Max simulator on an Apple Silicon Mac, RN 0.86.3, Static
Hermes, **dev bundle**. A release bundle is faster; a mid-range phone is
several times slower than this CPU. Read these as ratios, not as promises.

| Operation | Time |
| --- | --- |
| X25519 key pair | 6 ms |
| 100 one-time prekeys | 590 ms |
| Ed25519 identity | 5 ms |
| Sign / verify | 11 ms / 56 ms |
| X25519 DH | 18 ms |
| `initiateSession` (X3DH, per recipient device) | 131 ms |
| `acceptSession` | 77 ms |
| Message in an existing chain, encrypt or decrypt | 2 ms |
| Message that steps the DH ratchet (every change of direction) | 49 ms |
| Key material for one more recipient device | 2 ms |
| Payload 1 KB, encrypt or decrypt | 3 ms |
| Payload 1 MB, encrypt or decrypt | 1.4 s (AES-CBC 0.5 s + HMAC-SHA-256 0.9 s) |
| Payload 5 MB | 7 s |
| Base64 1 MB, encode / decode | 0.11 s / 0.20 s |

What follows from them:

- **Text is fine.** A message costs milliseconds; the first message to a
  device costs one X3DH.
- **Device setup must not run in one go.** 100 prekeys is over half a second
  here and seconds on a phone: generate in slices with a yield between them,
  after the UI is up (phase 2).
- **The first message into a large room** runs one X3DH per recipient device:
  yield between devices and show the message as pending meanwhile (phase 4).
- **Attachments cannot go through pure JS as they are.** A megabyte per
  1.4 s on the JS thread, in one blocking call. Phase 5 has to either use
  native AES/SHA (e.g. an optional `react-native-quick-crypto` peer, the way
  `react-native-mmkv` is optional for persistence) or process in chunks with
  yields — chunked HMAC measured the same total with 56 ms slices — and cap
  the size it accepts on the fallback path.
