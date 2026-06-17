/**
 * Shared helper: write a testbed Creds object into the installed app's
 * AsyncStorage on an iOS simulator or Android emulator, so the testbed
 * (AppLoginChatsRn) boots straight into Chat without driving the Setup UI.
 *
 * Extracted from scripts/seed-e2e-creds.mjs so both the profile-based
 * seeder and the interactive runner (scripts/e2e-interactive.mjs) share
 * one copy of the platform-specific storage write.
 *
 * Storage internals (must match @react-native-async-storage/async-storage):
 *   • iOS:     RCTAsyncLocalStorage_V1/<md5(key)> side-file + manifest.json
 *              (key hashed with MD5 — RCTMD5Hash in RNCAsyncStorage.mm).
 *   • Android: SQLite catalystLocalStorage(key,value) in
 *              /data/data/<pkg>/databases/RKStorage (needs a debuggable
 *              build so `run-as` works).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export const CREDS_KEY = '@apploginchatsrn/creds';
export const PKG = 'com.ethora.chatcomponentrn';

/**
 * Build the Creds object the testbed expects, in JWT mode.
 *
 * We seed `mode:'jwt'` with the raw client JWT (the token the user enters)
 * rather than email mode, because the testbed's Chat tab only needs
 * `creds.jwt` for the JWT path (AppLoginChatsRn `jwtLogin`) — it does the
 * `loginViaJwt` itself and connects. Email mode would additionally require
 * a non-empty `appToken`, which a JWT login never yields.
 */
export function buildCreds({
  clientJwt,
  baseUrl,
  xmppHost,
  xmppDevServer,
  conference,
  roomJid,
}) {
  return {
    mode: 'jwt',
    jwt: clientJwt,
    appToken: '',
    email: '',
    password: '',
    resolvedUser: null,
    baseUrl,
    // xmppHost is the WSS URL (wss://…/ws); xmppDevServer is the bare
    // host:port the client actually dials (wss://${xmppDevServer}/ws) —
    // they're DISTINCT testbed fields, so never alias them. Fall back to
    // xmppHost only if a dev server wasn't supplied.
    xmppHost,
    xmppDevServer: xmppDevServer || xmppHost,
    conference,
    singleRoom: !!roomJid,
    singleRoomJid: roomJid || '',
    // Tell the testbed to apply these creds and open the Chat tab on boot,
    // so the e2e flow lands in the room without driving the Setup UI.
    autoStart: true,
  };
}

/**
 * Write `creds` into the app's AsyncStorage on the target device.
 * Returns the byte length written. Throws on missing iosUdid.
 */
export function writeCredsToDevice({
  platform,
  iosUdid,
  androidSerial = 'emulator-5554',
  creds,
}) {
  const credsJson = JSON.stringify(creds);

  if (platform === 'ios') {
    if (!iosUdid) {
      throw new Error('writeCredsToDevice: ios requires iosUdid');
    }
    // Stop the app first so our write isn't clobbered by a background save.
    try {
      execSync(`xcrun simctl terminate ${iosUdid} ${PKG}`, { stdio: 'ignore' });
    } catch {}
    const dataDir = execSync(
      `xcrun simctl get_app_container ${iosUdid} ${PKG} data`
    )
      .toString()
      .trim();
    const dir = path.join(
      dataDir,
      'Library/Application Support',
      PKG,
      'RCTAsyncLocalStorage_V1'
    );
    fs.mkdirSync(dir, { recursive: true });
    const hash = crypto.createHash('md5').update(CREDS_KEY).digest('hex');
    fs.writeFileSync(path.join(dir, hash), credsJson);
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ [CREDS_KEY]: null })
    );
    return credsJson.length;
  }

  // Android: AsyncStorage = SQLite `catalystLocalStorage` in RKStorage.
  // Modern Android images (≥9) ship NO on-device `sqlite3`, so we can't run
  // SQL through `run-as sqlite3` like the old seeder did. Instead build the
  // RKStorage DB on the HOST (macOS sqlite3) and overwrite the app's copy
  // via `run-as cat` — the adb shell (uid shell) opens the pushed file for
  // the stdin redirect, so app-uid read perms on /data/local/tmp don't
  // matter. user_version=1 matches ReactDatabaseSupplier so it doesn't try
  // to (re)create the schema on open; stale journals are cleared so SQLite
  // reopens our committed DB cleanly.
  try {
    execSync(`adb -s ${androidSerial} shell am force-stop ${PKG}`, {
      stdio: 'ignore',
    });
  } catch {}
  const sql = [
    `PRAGMA user_version=1;`,
    `CREATE TABLE IF NOT EXISTS android_metadata (locale TEXT);`,
    `INSERT INTO android_metadata SELECT 'en_US' WHERE NOT EXISTS (SELECT 1 FROM android_metadata);`,
    `CREATE TABLE IF NOT EXISTS catalystLocalStorage(key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    `INSERT OR REPLACE INTO catalystLocalStorage(key, value) VALUES('${CREDS_KEY}', '${credsJson.replace(
      /'/g,
      "''"
    )}');`,
  ].join('\n');
  const localDb = '/tmp/maestro-RKStorage';
  fs.rmSync(localDb, { force: true });
  execSync(`sqlite3 ${localDb}`, { input: sql });
  execSync(`adb -s ${androidSerial} push ${localDb} /data/local/tmp/RKStorage`, {
    stdio: 'ignore',
  });
  execSync(
    `adb -s ${androidSerial} shell "run-as ${PKG} sh -c 'cat > databases/RKStorage; rm -f databases/RKStorage-journal databases/RKStorage-wal databases/RKStorage-shm' < /data/local/tmp/RKStorage"`
  );
  return credsJson.length;
}
