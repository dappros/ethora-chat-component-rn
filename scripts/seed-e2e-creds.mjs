#!/usr/bin/env node
/**
 * Seed the testbed AppLoginChatsRn AsyncStorage with logged-in Creds
 * so the Maestro e2e flow can skip the Setup tab entirely and boot
 * straight into the Chat tab.
 *
 * Why: typing the 600-char JWT app token into the Setup form via
 * `maestro inputText` is slow and lossy — sims occasionally drop
 * characters on long pastes, the iOS QuickPath ("Speed up your
 * typing") tutorial popup can intercept taps, and we have no
 * reliable way to confirm typed contents mid-flow. Pre-seeding via
 * AsyncStorage is both faster and far more reliable.
 *
 * This is also closer to how a real consumer app uses the SDK: the
 * consumer's own auth produces a (token, user) pair which they pass
 * straight into ReduxWrapper — they don't go through the testbed
 * Setup UI either.
 *
 * Env vars (set by scripts/run-e2e.sh):
 *   PROFILE_NAME — key into ~/.ethora/profiles.json
 *   PLATFORM     — "ios" or "android"
 *   IOS_UDID     — UDID for iOS sim (only when PLATFORM=ios)
 *   ROOM_TITLE   — room name for singleRoom mode (optional)
 *   ROOM_JID     — explicit JID for singleRoom mode (optional;
 *                  if absent we resolve via /chats/my)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const CREDS_KEY = '@apploginchatsrn/creds';
const PKG = 'com.ethora.chatcomponentrn';

const profileName = process.env.PROFILE_NAME;
const platform = process.env.PLATFORM;
const iosUdid = process.env.IOS_UDID || '';
const roomTitle = process.env.ROOM_TITLE || '';
const explicitRoomJid = process.env.ROOM_JID || '';

if (!profileName) {
  console.error('seed: missing PROFILE_NAME'); process.exit(2);
}
if (platform !== 'ios' && platform !== 'android') {
  console.error('seed: PLATFORM must be ios or android'); process.exit(2);
}

const profilesPath = `${process.env.HOME}/.ethora/profiles.json`;
const profile = JSON.parse(fs.readFileSync(profilesPath, 'utf8')).profiles[profileName];
if (!profile) {
  console.error(`seed: profile "${profileName}" not found`); process.exit(3);
}
const testUser = (profile.testUsers || [])[0];
if (!testUser) {
  console.error('seed: profile has no testUsers'); process.exit(4);
}

// Login the user and build the Creds payload the testbed expects.
const loginRes = await fetch(`${profile.endpoints.apiUrl}/users/login-with-email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: profile.appToken },
  body: JSON.stringify({ email: testUser.email, password: testUser.password }),
});
if (!loginRes.ok) {
  console.error(`seed: login ${testUser.email} failed: ${loginRes.status} ${await loginRes.text()}`);
  process.exit(5);
}
const { user, token, refreshToken } = await loginRes.json();
console.log(`seed: logged in ${user.email} (xmppUsername: ${user.xmppUsername})`);

// Resolve room JID if a title was given but no explicit JID.
let roomJid = explicitRoomJid;
if (roomTitle && !roomJid) {
  const roomsRes = await fetch(`${profile.endpoints.apiUrl}/chats/my`, {
    headers: { Authorization: token },
  });
  if (!roomsRes.ok) {
    console.error(`seed: /chats/my failed: ${roomsRes.status}`);
    process.exit(6);
  }
  const { items = [] } = await roomsRes.json();
  // The REST response doesn't include `jid`; the SDK reconstructs it
  // as `<name>@<conference>`. So do the same here.
  const match = items.find((r) => r.title === roomTitle || r.name === roomTitle);
  if (match) {
    roomJid = `${match.name}@${profile.endpoints.xmppConference}`;
  } else {
    // Fall back: pick the first room and warn.
    if (items[0]) {
      roomJid = `${items[0].name}@${profile.endpoints.xmppConference}`;
      console.warn(`seed: no room titled "${roomTitle}"; falling back to first room (${items[0].title || items[0].name})`);
    }
  }
}

const creds = {
  mode: 'email',
  jwt: '',
  appToken: profile.appToken,
  email: testUser.email,
  password: '',
  resolvedUser: {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    token,
    refreshToken,
    xmppUsername: user.xmppUsername,
    xmppPassword: user.xmppPassword,
    walletAddress: user.defaultWallet?.walletAddress || '',
    defaultWallet: user.defaultWallet || { walletAddress: '' },
  },
  baseUrl: profile.endpoints.apiUrl,
  xmppHost: profile.endpoints.xmppHost,
  xmppDevServer: profile.endpoints.xmppHost,
  conference: profile.endpoints.xmppConference,
  singleRoom: !!roomJid,
  singleRoomJid: roomJid || '',
};
const credsJson = JSON.stringify(creds);

// Stop the app first so the write isn't overwritten by background save.
if (platform === 'ios') {
  if (!iosUdid) { console.error('seed: ios requires IOS_UDID'); process.exit(7); }
  try { execSync(`xcrun simctl terminate ${iosUdid} ${PKG}`, { stdio: 'ignore' }); } catch {}
  // iOS RCTAsyncLocalStorage hashes the key with MD5 (NOT SHA1 — the
  // RCTMD5Hash usage in node_modules/@react-native-async-storage/
  // async-storage/ios/RNCAsyncStorage.mm). The manifest entry is
  // null when the value lives in a side-file.
  const dataDir = execSync(`xcrun simctl get_app_container ${iosUdid} ${PKG} data`).toString().trim();
  const dir = path.join(dataDir, 'Library/Application Support', PKG, 'RCTAsyncLocalStorage_V1');
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('md5').update(CREDS_KEY).digest('hex');
  fs.writeFileSync(path.join(dir, hash), credsJson);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ [CREDS_KEY]: null }));
  console.log(`seed: iOS wrote ${credsJson.length} bytes (singleRoom=${creds.singleRoom})`);
} else {
  // Android: @react-native-async-storage/async-storage uses SQLite at
  // /data/data/<pkg>/databases/RKStorage; schema is
  //   catalystLocalStorage(key TEXT PRIMARY KEY, value TEXT NOT NULL).
  try { execSync(`adb -s emulator-5554 shell am force-stop ${PKG}`, { stdio: 'ignore' }); } catch {}
  const sql = [
    `CREATE TABLE IF NOT EXISTS catalystLocalStorage(key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    `INSERT OR REPLACE INTO catalystLocalStorage(key, value) VALUES('${CREDS_KEY}', '${credsJson.replace(/'/g, "''")}');`,
  ].join('\n');
  const tmpSql = '/tmp/maestro-seed.sql';
  fs.writeFileSync(tmpSql, sql);
  execSync(`adb -s emulator-5554 push ${tmpSql} /data/local/tmp/maestro-seed.sql`, { stdio: 'ignore' });
  execSync(`adb -s emulator-5554 shell "run-as ${PKG} sqlite3 /data/data/${PKG}/databases/RKStorage < /data/local/tmp/maestro-seed.sql"`);
  console.log(`seed: Android upserted ${credsJson.length}-byte creds row (singleRoom=${creds.singleRoom})`);
}

// Emit ROOM_JID on a final line for the runner script to pick up.
if (roomJid) {
  console.log(`ROOM_JID=${roomJid}`);
}
