#!/usr/bin/env node
/**
 * Seed an iOS simulator's AppLoginChatsRn AsyncStorage with local JWT
 * credentials from an ignored JSON payload, so the testbed boots with
 * the JWT field already filled in without baking secrets into git.
 *
 * Usage:
 *   node scripts/seed-jwt-creds.mjs <IOS_UDID> [JWT]
 *
 * Optional local payload path:
 *   scripts/seed-jwt-creds.local.json
 *
 * Copy scripts/seed-jwt-creds.example.json to the local path above and
 * fill in your own values. Pass an optional second arg to override the
 * local-file JWT so two sims can log in as distinct users.
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
const here = path.dirname(fileURLToPath(import.meta.url));
const localCredsPath = path.join(here, 'seed-jwt-creds.local.json');

const udid = process.argv[2];
// Optional: a specific client JWT to seed (e.g. a per-user `type:client`
// token), overriding the ignored local-file JWT. Lets two sims log in as two
// distinct users from the same script.
const jwtOverride = process.argv[3];
if (!udid) {
  console.error('seed-jwt: usage: node scripts/seed-jwt-creds.mjs <IOS_UDID> [JWT]');
  process.exit(2);
}

const readLocalCreds = () => {
  if (!fs.existsSync(localCredsPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(localCredsPath, 'utf8'));
  } catch (error) {
    console.error(`seed-jwt: failed to parse ${localCredsPath}`);
    console.error(error);
    process.exit(3);
  }
};

const localCreds = readLocalCreds();

const creds = {
  mode: 'jwt',
  jwt: jwtOverride || localCreds.jwt || '',
  appToken: '',
  email: localCreds.email || '',
  password: localCreds.password || '',
  resolvedUser: null,
  baseUrl: localCreds.baseUrl || '',
  xmppHost: localCreds.xmppHost || '',
  xmppDevServer: localCreds.xmppDevServer || '',
  conference: localCreds.conference || '',
  singleRoom: false,
  singleRoomJid: '',
};

const missingFields = ['jwt', 'baseUrl', 'xmppHost', 'xmppDevServer', 'conference']
  .filter((key) => !creds[key]);
if (missingFields.length > 0) {
  console.error(
    `seed-jwt: missing required fields: ${missingFields.join(', ')}`
  );
  console.error(
    `seed-jwt: create ${localCredsPath} from scripts/seed-jwt-creds.example.json or pass a JWT as argv[3]`
  );
  process.exit(4);
}

const credsJson = JSON.stringify(creds);

// Stop the app so the write isn't clobbered by a background save.
try { execSync(`xcrun simctl terminate ${udid} ${PKG}`, { stdio: 'ignore' }); } catch {}

let dataDir;
try {
  dataDir = execSync(`xcrun simctl get_app_container ${udid} ${PKG} data`).toString().trim();
} catch {
  console.error(`seed-jwt: app ${PKG} not installed on ${udid} yet — install/run it once first.`);
  process.exit(5);
}

const dir = path.join(dataDir, 'Library/Application Support', PKG, 'RCTAsyncLocalStorage_V1');
fs.mkdirSync(dir, { recursive: true });
const hash = crypto.createHash('md5').update(CREDS_KEY).digest('hex');
fs.writeFileSync(path.join(dir, hash), credsJson);
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ [CREDS_KEY]: null }));

console.log(`seed-jwt: wrote ${credsJson.length} bytes of JWT creds to ${udid.slice(0, 8)} (jwt ${creds.jwt.length} chars)`);
