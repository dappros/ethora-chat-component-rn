/**
 * Shared helpers for the e2e runners (single-device interactive flow and
 * the two-device cross-messaging flow): token login, device resolution,
 * and Maestro launch. Kept dependency-free (plain fetch / child_process)
 * so the runners stay no-build .mjs scripts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { PKG } from './seed-creds.mjs';

/**
 * Log in with a client JWT — mirrors loginViaJwt (POST /users/client with
 * the x-custom-token header). Returns { user, token, refreshToken }.
 */
export async function loginViaToken({ baseUrl, token }) {
  const url = `${baseUrl.replace(/\/$/, '')}/users/client`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-custom-token': token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`login failed: POST ${url} → ${res.status} ${body}`);
  }
  const data = await res.json();
  const user = data.user || data;
  if (!user?.xmppUsername || !user?.xmppPassword) {
    throw new Error(
      'login succeeded but response has no xmppUsername/xmppPassword — wrong endpoint or token?'
    );
  }
  return { user, token: data.token, refreshToken: data.refreshToken || '' };
}

/** First booted iOS sim that has the app installed. Fails fast otherwise. */
export function resolveIosUdid() {
  const list = execSync('xcrun simctl list devices', { encoding: 'utf8' });
  const booted = [...list.matchAll(/\(([0-9A-F-]{36})\) \(Booted\)/g)].map(
    (m) => m[1]
  );
  if (!booted.length) {
    throw new Error(
      'no booted iOS simulator. Run `npm run ios` to build, install, and boot it.'
    );
  }
  for (const udid of booted) {
    try {
      execSync(`xcrun simctl get_app_container ${udid} ${PKG}`, {
        stdio: 'ignore',
      });
      return udid;
    } catch {}
  }
  throw new Error(
    `a sim is booted but ${PKG} is not installed on it. Run \`npm run ios\` first to build + install the app, then re-run.`
  );
}

/** First running Android emulator serial (emulator-XXXX, state "device"). */
export function resolveAndroidSerial() {
  const out = execSync('adb devices', { encoding: 'utf8' });
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('emulator-') && l.endsWith('device'));
  if (!line) {
    throw new Error(
      'no Android emulator running. Start one with `emulator -avd <name>` or `npm run android`.'
    );
  }
  return line.split(/\s+/)[0];
}

/** Env for invoking maestro: ~/.maestro/bin on PATH + JAVA_HOME (Android Studio JBR). */
export function maestroEnv() {
  const env = { ...process.env };
  env.PATH = `${path.join(os.homedir(), '.maestro', 'bin')}:${env.PATH}`;
  if (!env.JAVA_HOME) {
    const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
    if (fs.existsSync(jbr)) {env.JAVA_HOME = jbr;}
  }
  return env;
}

/**
 * Absolute path to the maestro launcher. Node's spawn resolves a bare
 * command name against the PARENT process PATH (not the child env we pass),
 * so `~/.maestro/bin` being on the child PATH isn't enough — resolve it here.
 */
export function maestroBin() {
  const local = path.join(os.homedir(), '.maestro', 'bin', 'maestro');
  return fs.existsSync(local) ? local : 'maestro';
}

/**
 * Run a Maestro flow. `device` is an iOS UDID or Android serial (passed as
 * --device so the right emulator is targeted when both are connected).
 * `vars` becomes `-e KEY=VALUE` pairs. Returns the exit status (does NOT
 * exit the process — callers sequence multiple runs).
 */
export function runMaestroFlow({ device, flow, vars = {}, label }) {
  if (!fs.existsSync(flow)) {
    throw new Error(`flow not found: ${flow}`);
  }
  const args = ['test'];
  if (device) {args.push('--device', device);}
  for (const [k, v] of Object.entries(vars)) {
    args.push('-e', `${k}=${v}`);
  }
  args.push(flow);
  if (label) {console.log(`\n▶ [${label}] maestro ${args.join(' ')}\n`);}
  const r = spawnSync(maestroBin(), args, {
    stdio: 'inherit',
    env: maestroEnv(),
  });
  if (r.error) {
    throw new Error(
      `failed to launch maestro (${r.error.message}). Install it: curl -Ls "https://get.maestro.mobile.dev" | bash`
    );
  }
  return r.status ?? 1;
}
