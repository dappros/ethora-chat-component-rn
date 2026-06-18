#!/usr/bin/env node
/**
 * Variant 2 — two-device cross-messaging e2e.
 *
 * Boots the app on BOTH a booted iOS simulator and a booted Android
 * emulator, logs in TWO different users (one token each) into the SAME
 * room, and drives a real cross-device round-trip through the UI:
 *
 *   iOS  (user A) sends  "<nonce>"  → Android (user B) asserts it arrives
 *   Android (user B) sends "<nonce>" → iOS (user A) asserts it arrives
 *
 * Both sides are real native UIs driven by Maestro (one `maestro --device`
 * invocation per device per step). Delivery is asserted automatically — no
 * human watches either screen.
 *
 *   Usage:  npm run e2e:two
 *           node scripts/e2e-two-device.mjs
 *
 * Prereqs: a booted iOS sim AND a booted Android emulator, each with the
 * app installed (`npm run ios` and `npm run android` once), plus Maestro.
 *
 * You are asked for (cached to e2e/.e2e-two-creds.json, gitignored):
 *   Base URL, XMPP host, XMPP conference, Room JID  — shared by both users
 *   Token (iOS / user A), Token (Android / user B)  — one client JWT each
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCreds, writeCredsToDevice } from './lib/seed-creds.mjs';
import {
  loginViaToken,
  resolveIosUdid,
  resolveAndroidSerial,
  runMaestroFlow,
} from './lib/e2e-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_PATH = path.join(ROOT, 'e2e', '.e2e-two-creds.json');
const SEND_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-send.yaml');
const SEND_OPEN_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-send-open.yaml');
const RECEIVE_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-receive.yaml');
const EDIT_OPEN_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-edit-open.yaml');
const DELETE_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-delete.yaml');
const VERIFY_DELETED_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-verify-deleted.yaml');

const FIELDS = [
  { key: 'baseUrl', label: 'Base URL', env: 'E2E_BASE_URL' },
  { key: 'xmppHost', label: 'XMPP host (wss://…/ws)', env: 'E2E_XMPP_HOST' },
  {
    key: 'xmppDevServer',
    label: 'XMPP dev server (host:port)',
    env: 'E2E_XMPP_DEV_SERVER',
  },
  { key: 'conference', label: 'XMPP conference', env: 'E2E_CONFERENCE' },
  { key: 'roomJid', label: 'Room JID', env: 'E2E_ROOM_JID' },
  { key: 'tokenIos', label: 'Token (iOS / user A)', env: 'E2E_TOKEN_IOS' },
  {
    key: 'tokenAndroid',
    label: 'Token (Android / user B)',
    env: 'E2E_TOKEN_ANDROID',
  },
];

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) {return null;}
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function requireComplete(creds) {
  for (const { key } of FIELDS) {
    if (!creds[key]) {
      console.error(
        `error: missing "${key}" — provide it via prompt, env, or cache`
      );
      process.exit(2);
    }
  }
  return creds;
}

async function gatherCreds() {
  const cached = readCache() || {};
  const fromEnv = {};
  for (const { key, env } of FIELDS) {
    if (process.env[env]) {fromEnv[key] = process.env[env];}
  }
  if (!input.isTTY) {
    return requireComplete({ ...cached, ...fromEnv });
  }
  const rl = readline.createInterface({ input, output });
  try {
    const base = { ...cached, ...fromEnv };
    if (cached.baseUrl && Object.keys(fromEnv).length === 0) {
      const reuse = (
        await rl.question(
          `Use saved creds for ${cached.baseUrl} (room ${cached.roomJid})? [Y/n] `
        )
      )
        .trim()
        .toLowerCase();
      if (reuse === '' || reuse === 'y' || reuse === 'yes') {
        return requireComplete(cached);
      }
    }
    const creds = {};
    for (const { key, label } of FIELDS) {
      const fallback = base[key];
      const suffix = fallback ? ` [${fallback}]` : '';
      const answer = (await rl.question(`${label}${suffix}: `)).trim();
      creds[key] = answer || fallback || '';
    }
    requireComplete(creds);
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(creds, null, 2));
    console.log(`(saved to ${path.relative(ROOT, CACHE_PATH)} — gitignored)`);
    return creds;
  } finally {
    rl.close();
  }
}

// Resolve the on-screen centre of the send button via a uiautomator dump
// (content-desc == the accessibilityLabel we set on it).
// Dump the current view hierarchy XML (empty string if uiautomator can't get
// an idle frame, e.g. while the message-list spinner is animating).
function dumpXml(device) {
  try {
    execSync(`adb -s ${device} shell uiautomator dump /sdcard/ui.xml`, {
      stdio: 'ignore',
    });
    return execSync(`adb -s ${device} shell cat /sdcard/ui.xml`).toString();
  } catch {
    return '';
  }
}

const SEND_BTN_RE =
  /content-desc="chat-send-button"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;

// Tap the send button until it disappears. The button is only rendered while
// the input has content (empty input shows the mic), so its disappearance
// means the message was sent. Looping past a missed tap (the soft-keyboard
// layout shifts the button between dump and tap) is what makes this reliable.
// Returns true if sent.
function androidTapSendUntilGone(device) {
  let sawButton = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    execSync(`adb -s ${device} shell sleep 1`);
    const m = dumpXml(device).match(SEND_BTN_RE);
    if (m) {
      sawButton = true;
      const x = Math.round((+m[1] + +m[3]) / 2);
      const y = Math.round((+m[2] + +m[4]) / 2);
      execSync(`adb -s ${device} shell input tap ${x} ${y}`);
    } else if (sawButton) {
      return true;
    }
    // else: dump not ready yet (spinner) — keep waiting for the button.
  }
  return false;
}

// Type the nonce into the (empty, focused) input, then send. Used for the
// Android SENDER, where Maestro's inputText hangs.
function androidTypeAndSend(device, nonce) {
  execSync(`adb -s ${device} shell input text '${nonce}'`);
  return androidTapSendUntilGone(device);
}

// Replace the pre-filled edit text with `newText`, then send the edit. adb key
// events are REAL key events, so (unlike Maestro on iOS) they fire the
// TextInput's onChangeText and the edit actually changes the body. Clears the
// old text by jumping to the end and deleting generously, then types the new
// text. Returns true if the edit was sent.
function androidEditAndSend(device, newText) {
  // KEYCODE_MOVE_END=123, KEYCODE_DEL=67. Delete more than any nonce length.
  execSync(`adb -s ${device} shell input keyevent 123`);
  for (let i = 0; i < 24; i++) {
    execSync(`adb -s ${device} shell input keyevent 67`);
  }
  execSync(`adb -s ${device} shell input text '${newText}'`);
  return androidTapSendUntilGone(device);
}

// Type + send a message through the UI.
//   iOS:     a single Maestro flow (its inputText works).
//   Android: Maestro's inputText hangs (gRPC DEADLINE on API 36) AND a second
//            Maestro invocation resets the app off the room — so we use ONE
//            Maestro flow to open + focus, then drive type + send-tap via adb
//            in the same (still-foreground) session. The receiver assertion is
//            the real cross-device proof, so no sender-side assert is needed.
function sendViaUi({ device, isAndroid, nonce, label }) {
  if (!isAndroid) {
    return runMaestroFlow({
      device,
      flow: SEND_FLOW,
      vars: { NONCE: nonce },
      label,
    });
  }
  const opened = runMaestroFlow({
    device,
    flow: SEND_OPEN_FLOW,
    label: `${label}:open`,
  });
  if (opened !== 0) {return opened;}
  // Field is focused by the open flow; type + send via adb so the app stays in
  // the room (no second Maestro session, which would reset it off the room).
  const sent = androidTypeAndSend(device, nonce);
  console.log(`  [${label}] type + send via adb → ${sent ? 'sent' : 'FAILED'}`);
  return sent ? 0 : 1;
}

// Assert a piece of text shows up on `receiver` (sent or edited body).
function expectText(receiver, text, label) {
  if (
    runMaestroFlow({
      device: receiver,
      flow: RECEIVE_FLOW,
      vars: { NONCE: text },
      label,
    }) !== 0
  ) {
    throw new Error(`${label}: did not see "${text}"`);
  }
}

// Assert a deleted message's text is gone on `receiver`.
function expectDeleted(receiver, text, label) {
  if (
    runMaestroFlow({
      device: receiver,
      flow: VERIFY_DELETED_FLOW,
      vars: { TEXT: text },
      label,
    }) !== 0
  ) {
    throw new Error(`${label}: "${text}" still visible (not deleted)`);
  }
}

(async () => {
  const answers = await gatherCreds();
  const roomJid = answers.roomJid.includes('@')
    ? answers.roomJid
    : `${answers.roomJid}@${answers.conference}`;
  const shared = {
    baseUrl: answers.baseUrl,
    xmppHost: answers.xmppHost,
    xmppDevServer: answers.xmppDevServer,
    conference: answers.conference,
    roomJid,
  };

  // Preflight the devices BEFORE logging in — both an iOS sim and an
  // Android emulator must be booted with the app installed. Failing here
  // (instead of after login) gives a clear "set up your devices" message.
  const iosUdid = resolveIosUdid();
  const androidSerial = resolveAndroidSerial();
  console.log(`devices: iOS ${iosUdid} | Android ${androidSerial}`);

  console.log(`\nLogging in both users against ${shared.baseUrl} …`);
  const a = await loginViaToken({ baseUrl: shared.baseUrl, token: answers.tokenIos });
  const b = await loginViaToken({
    baseUrl: shared.baseUrl,
    token: answers.tokenAndroid,
  });
  console.log(`✓ iOS user A: ${a.user.email || a.user.xmppUsername}`);
  console.log(`✓ Android user B: ${b.user.email || b.user.xmppUsername}`);

  writeCredsToDevice({
    platform: 'ios',
    iosUdid,
    creds: buildCreds({ clientJwt: answers.tokenIos, ...shared }),
  });
  writeCredsToDevice({
    platform: 'android',
    androidSerial,
    creds: buildCreds({ clientJwt: answers.tokenAndroid, ...shared }),
  });
  console.log(`✓ seeded both devices into ${roomJid}`);

  // Keep nonces SHORT so they fit on one line in the testbed's large cursive
  // message font (fontSize 26) — a long body wraps and iOS accessibility then
  // splits it so Maestro can't match the full string. A 6-char timestamp tail
  // stays unique per run and won't collide with the room's numeric messages.
  const tag = `${Date.now()}`.slice(-6);
  const nonceI = `i2a${tag}`; // iOS sends this
  const nonceA = `a2i${tag}`; // Android sends this
  const nonceAe = `aed${tag}`; // Android edits its message to this

  // Each step runs and records pass/fail without aborting the rest, so the
  // final summary shows exactly which of send/edit/delete worked each way.
  const results = [];
  const step = (label, fn) => {
    console.log(`\n=== ${label} ===`);
    try {
      fn();
      results.push({ label, ok: true });
      console.log(`✓ ${label}`);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      results.push({ label, ok: false, error: err.message });
    }
  };

  // ── Phase 1: SEND (both directions) ──────────────────────────────────────
  step('SEND iOS → Android', () => {
    if (
      sendViaUi({ device: iosUdid, isAndroid: false, nonce: nonceI, label: 'send@ios' }) !== 0
    ) {throw new Error('iOS send flow failed');}
    expectText(androidSerial, nonceI, 'receive@android');
  });
  step('SEND Android → iOS', () => {
    if (
      sendViaUi({ device: androidSerial, isAndroid: true, nonce: nonceA, label: 'send@android' }) !== 0
    ) {throw new Error('Android send flow failed');}
    expectText(iosUdid, nonceA, 'receive@ios');
  });

  // ── Phase 2: DELETE (both directions) ────────────────────────────────────
  // NOTE: edit-with-text-change is intentionally NOT here — a pre-filled,
  // controlled multiline TextInput rejects external text changes on BOTH
  // platforms (Maestro on iOS, adb key events on Android: the value prop snaps
  // back). The edit ACTION fires but the body can't be changed, so there's
  // nothing new to assert cross-device. Send + delete are the reliable pair.
  step('DELETE iOS → Android', () => {
    if (runMaestroFlow({ device: iosUdid, flow: DELETE_FLOW, vars: { TEXT: nonceI }, label: 'delete@ios' }) !== 0) {
      throw new Error('iOS delete flow failed');
    }
    expectDeleted(androidSerial, nonceI, 'verify-deleted@android');
  });
  step('DELETE Android → iOS', () => {
    if (runMaestroFlow({ device: androidSerial, flow: DELETE_FLOW, vars: { TEXT: nonceA }, label: 'delete@android' }) !== 0) {
      throw new Error('Android delete flow failed');
    }
    expectDeleted(iosUdid, nonceA, 'verify-deleted@ios');
  });

  console.log('\n──────── summary ────────');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.label}${r.ok ? '' : ` — ${r.error}`}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} steps passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
