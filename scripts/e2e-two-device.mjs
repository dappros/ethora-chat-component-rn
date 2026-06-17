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
const SEND_SUBMIT_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-send-submit.yaml');
const RECEIVE_FLOW = path.join(ROOT, 'e2e', 'flows', '_two-receive.yaml');

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

// Type the nonce, then tap the send button until it disappears. The button is
// only rendered while the input has content (empty input shows the mic), so
// its disappearance means the message was sent. Looping past a missed tap
// (the soft-keyboard layout shifts the button between dump and tap) is what
// makes this reliable. Returns true if sent.
function androidTypeAndSend(device, nonce) {
  execSync(`adb -s ${device} shell input text '${nonce}'`);
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
      // The button was present (input had text) and is now gone → sent.
      return true;
    }
    // else: dump not ready yet (spinner) — keep waiting for the button.
  }
  return false;
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

// One direction: sender sends a nonce, receiver asserts it arrives.
function roundTrip({ label, sender, senderIsAndroid, receiver, nonce }) {
  console.log(`\n=== ${label} ===`);
  const sent = sendViaUi({
    device: sender,
    isAndroid: senderIsAndroid,
    nonce,
    label: `send@${sender}`,
  });
  if (sent !== 0) {
    throw new Error(`${label}: sender flow failed (exit ${sent})`);
  }
  const got = runMaestroFlow({
    device: receiver,
    flow: RECEIVE_FLOW,
    vars: { NONCE: nonce },
    label: `receive@${receiver}`,
  });
  if (got !== 0) {
    throw new Error(
      `${label}: receiver did not see "${nonce}" (exit ${got})`
    );
  }
  console.log(`✓ ${label}: "${nonce}" delivered`);
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

  const runId = `${Date.now()}`;
  const directions = [
    {
      label: 'iOS → Android',
      sender: iosUdid,
      senderIsAndroid: false,
      receiver: androidSerial,
      nonce: `e2e-i2a-${runId}`,
    },
    {
      label: 'Android → iOS',
      sender: androidSerial,
      senderIsAndroid: true,
      receiver: iosUdid,
      nonce: `e2e-a2i-${runId}`,
    },
  ];
  // Run both directions; don't let one failure abort the other — report a
  // summary so a partial pass (e.g. iOS→Android green, Android→iOS flaky on a
  // bleeding-edge emulator) is still visible.
  const results = [];
  for (const d of directions) {
    try {
      roundTrip(d);
      results.push({ label: d.label, ok: true });
    } catch (err) {
      console.error(`✗ ${err.message}`);
      results.push({ label: d.label, ok: false, error: err.message });
    }
  }

  console.log('\n──────── summary ────────');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.label}${r.ok ? '' : ` — ${r.error}`}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} directions delivered`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
