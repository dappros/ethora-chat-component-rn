#!/usr/bin/env node
/**
 * Seed an iOS simulator's AppLoginChatsRn AsyncStorage with the
 * built-in JWT test creds (DEFAULT_CREDS from AppLoginChatsRn.tsx),
 * so the testbed boots with the JWT field already filled in.
 *
 * The JWT + endpoints are read live from AppLoginChatsRn.tsx so this
 * never drifts from the source of truth.
 *
 * Usage:
 *   node scripts/seed-jwt-creds.mjs <IOS_UDID> [JWT]
 *
 * Pass an optional second arg to override DEFAULT_CREDS.jwt with a
 * specific client JWT — lets two sims log in as two distinct users.
 *
 * Mechanism (matches scripts/seed-e2e-creds.mjs): iOS
 * RCTAsyncLocalStorage hashes each key with MD5 and stores long
 * values in a side-file named after that hash, with a null entry in
 * manifest.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const CREDS_KEY = '@apploginchatsrn/creds';
const PKG = 'com.ethora.chatcomponentrn';

const udid = process.argv[2];
// Optional: a specific client JWT to seed (e.g. a per-user `type:client`
// token), overriding DEFAULT_CREDS.jwt. Lets two sims log in as two
// distinct users from the same script.
const jwtOverride = process.argv[3];
if (!udid) {
  console.error('seed-jwt: usage: node scripts/seed-jwt-creds.mjs <IOS_UDID> [JWT]');
  process.exit(2);
}

// --- Read DEFAULT_CREDS values live from the testbed source. ---------
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'AppLoginChatsRn.tsx'), 'utf8');

const pick = (key, fallback) => {
  const m = src.match(new RegExp(`${key}:\\s*'([^']*)'`));
  return m ? m[1] : fallback;
};

const creds = {
  mode: 'jwt',
  jwt: jwtOverride || pick('jwt', ''),
  appToken: '',
  email: pick('email', ''),
  password: pick('password', ''),
  resolvedUser: null,
  baseUrl: pick('baseUrl', 'https://api.messenger-dev2.vitall.com/v1'),
  xmppHost: pick('xmppHost', 'xmpp.messenger-dev2.vitall.com'),
  xmppDevServer: pick('xmppDevServer', 'xmpp.messenger-dev2.vitall.com'),
  conference: pick('conference', 'conference.xmpp.messenger-dev2.vitall.com'),
  singleRoom: false,
  singleRoomJid: '',
};

if (!creds.jwt) {
  console.error('seed-jwt: could not extract JWT from AppLoginChatsRn.tsx');
  process.exit(3);
}

const credsJson = JSON.stringify(creds);

// Stop the app so the write isn't clobbered by a background save.
try { execSync(`xcrun simctl terminate ${udid} ${PKG}`, { stdio: 'ignore' }); } catch {}

let dataDir;
try {
  dataDir = execSync(`xcrun simctl get_app_container ${udid} ${PKG} data`).toString().trim();
} catch {
  console.error(`seed-jwt: app ${PKG} not installed on ${udid} yet — install/run it once first.`);
  process.exit(4);
}

const dir = path.join(dataDir, 'Library/Application Support', PKG, 'RCTAsyncLocalStorage_V1');
fs.mkdirSync(dir, { recursive: true });
const hash = crypto.createHash('md5').update(CREDS_KEY).digest('hex');
fs.writeFileSync(path.join(dir, hash), credsJson);
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ [CREDS_KEY]: null }));

console.log(`seed-jwt: wrote ${credsJson.length} bytes of JWT creds to ${udid.slice(0, 8)} (jwt ${creds.jwt.length} chars)`);
