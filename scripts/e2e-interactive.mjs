#!/usr/bin/env node
/**
 * Interactive e2e runner.
 *
 * Unlike scripts/run-e2e.sh (which pulls everything from
 * ~/.ethora/profiles.json), this runner ASKS for the credentials at the
 * prompt, logs the user in with the token, seeds the testbed, and drives
 * the comprehensive Maestro UI flow on a booted simulator/emulator.
 *
 *   Usage:  node scripts/e2e-interactive.mjs ios|android
 *           npm run e2e:ui -- ios
 *
 * You are asked for (cached to e2e/.e2e-creds.json, which is gitignored):
 *   • Base URL        — REST API root, e.g. https://api.ethoradev.com/v1
 *   • XMPP host       — WebSocket host, e.g. xmpp.ethoradev.com
 *   • XMPP conference — MUC domain, e.g. conference.xmpp.ethoradev.com
 *   • Token           — a client JWT accepted at POST /users/client
 *                       (the `x-custom-token`; this is what loginViaJwt uses)
 *   • Room JID        — the room to open (bare name or full <name>@<conference>)
 *
 * The login mirrors src/networking/api-requests/auth.api.ts::loginViaJwt
 * (POST /users/client with the x-custom-token header) but uses plain fetch
 * so this stays a dependency-free .mjs with no transpile step.
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
const CACHE_PATH = path.join(ROOT, 'e2e', '.e2e-creds.json');
const FIXTURES_DIR = path.join(ROOT, 'e2e', 'fixtures');
const FLOW = path.join(ROOT, 'e2e', 'flows', 'full-ui-flow.yaml');

const platform = (process.argv[2] || '').toLowerCase();
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: node scripts/e2e-interactive.mjs ios|android');
  process.exit(1);
}

const FIELDS = [
  { key: 'baseUrl', label: 'Base URL', env: 'E2E_BASE_URL' },
  { key: 'xmppHost', label: 'XMPP host (wss://…/ws)', env: 'E2E_XMPP_HOST' },
  {
    key: 'xmppDevServer',
    label: 'XMPP dev server (host:port)',
    env: 'E2E_XMPP_DEV_SERVER',
  },
  { key: 'conference', label: 'XMPP conference', env: 'E2E_CONFERENCE' },
  { key: 'token', label: 'Token (client JWT)', env: 'E2E_TOKEN' },
  { key: 'roomJid', label: 'Room JID', env: 'E2E_ROOM_JID' },
];

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) {return null;}
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(creds) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(creds, null, 2));
  console.log(`(saved to ${path.relative(ROOT, CACHE_PATH)} — gitignored)`);
}

function requireComplete(creds) {
  for (const { key } of FIELDS) {
    if (!creds[key]) {
      console.error(`error: missing "${key}" — provide it via prompt, env, or cache`);
      process.exit(2);
    }
  }
  return creds;
}

/**
 * Resolve creds from (in priority order) env vars → cache → interactive
 * prompt. Env wins so CI / tests can run without a TTY; the prompt only
 * runs when stdin is a real terminal.
 */
async function gatherCreds() {
  const cached = readCache() || {};
  const fromEnv = {};
  for (const { key, env } of FIELDS) {
    if (process.env[env]) {fromEnv[key] = process.env[env];}
  }

  // Non-interactive (piped / CI): env + cache only, no prompts.
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
    saveCache(creds);
    return creds;
  } finally {
    rl.close();
  }
}

// ── Media fixtures → device gallery / files (best-effort) ──────────────────
function seedMedia({ iosUdid, androidSerial }) {
  const image = path.join(FIXTURES_DIR, 'image.jpg');
  const video = path.join(FIXTURES_DIR, 'video.mp4');
  const pdf = path.join(FIXTURES_DIR, 'document.pdf');
  const present = [image, video, pdf].filter((f) => fs.existsSync(f));
  if (!present.length) {
    console.warn(
      'warn: no fixtures in e2e/fixtures/ — media steps will be skipped by the flow.'
    );
    return;
  }
  if (platform === 'ios') {
    const photos = [image, video].filter((f) => fs.existsSync(f));
    if (photos.length) {
      execSync(`xcrun simctl addmedia ${iosUdid} ${photos.map((p) => `'${p}'`).join(' ')}`);
      console.log(`seeded iOS Photos with ${photos.length} item(s)`);
    }
    // PDF for the document picker on iOS sim is unreliable to seed (Files
    // app); the flow treats the PDF leg as best-effort. See plan Risk 2.
    if (fs.existsSync(pdf)) {
      console.warn(
        'note: iOS document-picker seeding for the PDF is best-effort; if the picker is empty, cover PDF via the headless suite.'
      );
    }
  } else {
    const adb = (args) =>
      execSync(`adb -s ${androidSerial} ${args}`, { stdio: 'ignore' });
    if (fs.existsSync(image)) {adb(`push '${image}' /sdcard/Pictures/e2e-image.jpg`);}
    if (fs.existsSync(video)) {adb(`push '${video}' /sdcard/Movies/e2e-video.mp4`);}
    if (fs.existsSync(pdf)) {adb(`push '${pdf}' /sdcard/Download/e2e-document.pdf`);}
    // Make the media store index the new files so gallery/SAF see them.
    try {
      adb(
        `shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/e2e-image.jpg"`
      );
      adb(
        `shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Movies/e2e-video.mp4"`
      );
    } catch {}
    console.log(`seeded Android storage with ${present.length} fixture(s)`);
  }
}

// ── Run Maestro ────────────────────────────────────────────────────────────
function runMaestro({ iosUdid, androidSerial, roomJid }) {
  const status = runMaestroFlow({
    device: platform === 'ios' ? iosUdid : androidSerial,
    flow: FLOW,
    vars: { ROOM_JID: roomJid, RUN_ID: `${Date.now()}`, PLATFORM: platform },
  });
  process.exit(status);
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const answers = await gatherCreds();
  const roomJid = answers.roomJid.includes('@')
    ? answers.roomJid
    : `${answers.roomJid}@${answers.conference}`;

  console.log(`\nLogging in against ${answers.baseUrl} …`);
  const { user, token, refreshToken } = await loginViaToken(answers);
  console.log(`✓ logged in as ${user.email || user.xmppUsername}`);

  const iosUdid = platform === 'ios' ? resolveIosUdid() : '';
  const androidSerial = platform === 'android' ? resolveAndroidSerial() : '';
  console.log(
    `device: ${platform === 'ios' ? iosUdid : androidSerial}`
  );

  const creds = buildCreds({
    clientJwt: answers.token,
    baseUrl: answers.baseUrl,
    xmppHost: answers.xmppHost,
    xmppDevServer: answers.xmppDevServer,
    conference: answers.conference,
    roomJid,
  });
  const bytes = writeCredsToDevice({ platform, iosUdid, androidSerial, creds });
  console.log(`✓ seeded ${bytes}-byte creds (singleRoom → ${roomJid})`);

  seedMedia({ iosUdid, androidSerial });

  runMaestro({ iosUdid, androidSerial, roomJid });
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
