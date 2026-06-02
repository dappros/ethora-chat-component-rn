#!/usr/bin/env node
/**
 * Android counterpart of scripts/seed-jwt-creds.mjs. Writes the same
 * `@apploginchatsrn/creds` payload into the emulator's RKStorage
 * SQLite database (which is where @react-native-async-storage/async-
 * storage persists on Android) so the testbed boots with the JWT and
 * server URLs already populated.
 *
 * Usage:
 *   node scripts/seed-jwt-creds-android.mjs [JWT]            # device picked by adb auto
 *   node scripts/seed-jwt-creds-android.mjs <SERIAL> [JWT]   # explicit `adb -s` serial
 *
 * Reads URLs/JWT from scripts/seed-jwt-creds.local.json (gitignored).
 * Optional positional arg overrides the local-file JWT.
 *
 * Prereqs: an emulator (or device) connected via adb. The APK must be
 * installed beforehand (this script writes into its sandbox); install
 * with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const CREDS_KEY = '@apploginchatsrn/creds';
const PKG = 'com.ethora.chatcomponentrn';
const here = path.dirname(fileURLToPath(import.meta.url));
const localCredsPath = path.join(here, 'seed-jwt-creds.local.json');

// CLI: distinguish "device serial" from "JWT override". A JWT is a
// 3-segment token containing dots; a device serial doesn't. Lets the
// user call either way without flags.
const args = process.argv.slice(2);
let serial = '';
let jwtOverride = '';
for (const a of args) {
  if (a.includes('.') && a.split('.').length === 3) {jwtOverride = a;}
  else {serial = a;}
}

const adb = (cmd, opts = {}) => {
  const prefix = serial ? `adb -s ${serial}` : 'adb';
  return execSync(`${prefix} ${cmd}`, { encoding: 'utf8', ...opts });
};

// ── Discover a connected device if no serial was given ───────────────
if (!serial) {
  try {
    const out = execSync('adb devices', { encoding: 'utf8' });
    const lines = out
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l && /\sdevice$/.test(l));
    if (lines.length === 0) {
      console.error(
        'seed-jwt-android: no adb devices online. Boot an emulator (or plug in a device) and try again.'
      );
      process.exit(2);
    }
    serial = lines[0].split(/\s+/)[0];
    console.log(`seed-jwt-android: using device ${serial}`);
  } catch (err) {
    console.error('seed-jwt-android: adb not available —', err.message);
    process.exit(3);
  }
}

// ── Read the gitignored local creds payload ──────────────────────────
const readLocalCreds = () => {
  if (!fs.existsSync(localCredsPath)) {return {};}
  try {return JSON.parse(fs.readFileSync(localCredsPath, 'utf8'));}
  catch (err) {
    console.error(`seed-jwt-android: failed to parse ${localCredsPath}`);
    console.error(err);
    process.exit(4);
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

const missing = ['jwt', 'baseUrl', 'xmppHost', 'xmppDevServer', 'conference']
  .filter((k) => !creds[k]);
if (missing.length) {
  console.error(`seed-jwt-android: missing required fields: ${missing.join(', ')}`);
  console.error(
    `seed-jwt-android: create ${localCredsPath} from scripts/seed-jwt-creds.example.json or pass a JWT as argv`
  );
  process.exit(5);
}

const credsJson = JSON.stringify(creds);

// ── Verify package + RKStorage db are present ────────────────────────
// First check the app is installed.
try {
  const pkgs = adb(`shell pm list packages ${PKG}`);
  if (!pkgs.includes(`package:${PKG}`)) {
    console.error(
      `seed-jwt-android: ${PKG} not installed on ${serial}. Install the APK first: \n  adb -s ${serial} install -r android/app/build/outputs/apk/debug/app-debug.apk`
    );
    process.exit(6);
  }
} catch (err) {
  console.error('seed-jwt-android: pm list failed —', err.message);
  process.exit(6);
}

// Stop the app so the SQLite write isn't clobbered by a background save.
try { adb(`shell am force-stop ${PKG}`); } catch {}

// ── Push + execute a SQLite UPSERT into RKStorage ────────────────────
// RKStorage is async-storage's SQLite-backed schema: a single `catalystLocalStorage`
// table with (key, value) columns. INSERT OR REPLACE matches the
// existing seed-e2e-creds.mjs pattern (verified to work on emulator).
//
// We URL-encode the JSON value to keep SQL escaping simple (single quotes
// inside a JWT-base64 value would otherwise break the literal). The
// SQLite trick: REPLACE() builds the value via `replace(<encoded>, '%XX', char(0xXX))`
// — but easier: just escape single quotes with `''` and write directly.
const sqlEscaped = credsJson.replace(/'/g, "''");
const sql = `INSERT OR REPLACE INTO catalystLocalStorage (key, value) VALUES ('${CREDS_KEY}', '${sqlEscaped}');`;
const tmpSql = `/tmp/seed-jwt-android-${process.pid}.sql`;
fs.writeFileSync(tmpSql, sql);
try {
  adb(`push ${tmpSql} /data/local/tmp/seed-jwt.sql`, { stdio: 'ignore' });
  // run-as <pkg> runs sqlite3 inside the app's sandbox (no root needed).
  adb(
    `shell "run-as ${PKG} sh -c 'sqlite3 /data/data/${PKG}/databases/RKStorage < /data/local/tmp/seed-jwt.sql'"`,
    { stdio: 'ignore' }
  );
  console.log(
    `seed-jwt-android: wrote ${credsJson.length} bytes of JWT creds to ${serial} (jwt ${creds.jwt.length} chars)`
  );
} catch (err) {
  console.error('seed-jwt-android: sqlite write failed —', err.message);
  console.error(
    'Hint: app may not have created /databases/RKStorage yet — launch it once, write something to AsyncStorage, then re-seed.'
  );
  process.exit(7);
} finally {
  try { fs.unlinkSync(tmpSql); } catch {}
}
