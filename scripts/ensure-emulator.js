#!/usr/bin/env node
/**
 * Make sure there's an Android device or emulator ready before
 * `expo run:android` is invoked. Without this, first-time runs hit
 * the opaque "No Android connected device found, and no emulators
 * could be started automatically" error even when the developer has
 * AVDs configured in Android Studio — expo's auto-boot is unreliable
 * unless `--device <name>` is passed.
 *
 * Behaviour:
 *   1. If `adb devices` shows any `<id>\tdevice` line, exit 0 (good).
 *   2. Otherwise resolve ANDROID_HOME (env or platform default),
 *      `emulator -list-avds`, pick the first AVD, launch it in the
 *      background, and poll `adb shell getprop sys.boot_completed`
 *      until it returns `1` or we time out.
 *   3. Helpful, non-fatal exits when ANDROID_HOME or AVDs are missing
 *      so the developer gets a clear next-step instead of a stack.
 *
 * Cross-platform (macOS / Linux / Windows). Synchronous & no deps —
 * intentional: this runs from an npm `pre-` style hook, fast startup
 * matters more than fancy logging.
 */

const { execFileSync, spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const BOOT_TIMEOUT_MS = 120_000; // 2 min — enough for cold AVD boot on a slow laptop
const POLL_INTERVAL_MS = 2_000;

function log(msg) {
  process.stdout.write(`[ensure-emulator] ${msg}\n`);
}

function resolveAndroidHome() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const home = homedir();
  const candidates = [];
  switch (process.platform) {
    case 'darwin':
      candidates.push(join(home, 'Library', 'Android', 'sdk'));
      break;
    case 'linux':
      candidates.push(join(home, 'Android', 'Sdk'));
      candidates.push(join(home, 'Android', 'sdk'));
      break;
    case 'win32':
      if (process.env.LOCALAPPDATA) {
        candidates.push(join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
      }
      break;
  }
  return candidates.find((c) => existsSync(c)) || null;
}

function listAvds(emulatorBin) {
  try {
    const out = execFileSync(emulatorBin, ['-list-avds'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function listDevices(adbBin) {
  try {
    const out = execFileSync(adbBin, ['devices'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /\tdevice$/.test(l))
      .map((l) => l.split('\t')[0]);
  } catch {
    return [];
  }
}

function isBooted(adbBin) {
  try {
    const out = execFileSync(adbBin, ['shell', 'getprop', 'sys.boot_completed'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out === '1';
  } catch {
    return false;
  }
}

function sleep(ms) {
  // Synchronous sleep using Atomics on a tiny shared buffer — avoids
  // pulling in any async machinery for a script that's intentionally
  // top-to-bottom procedural.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

(function main() {
  const androidHome = resolveAndroidHome();
  if (!androidHome) {
    log('ANDROID_HOME is not set and no Android SDK found at the default location.');
    log('Install Android Studio (https://developer.android.com/studio) or set ANDROID_HOME, then try again.');
    process.exit(1);
  }

  const adbBin = join(androidHome, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const emulatorBin = join(androidHome, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');

  if (!existsSync(adbBin)) {
    log(`adb not found at ${adbBin}.`);
    log('Open Android Studio → SDK Manager → SDK Tools and install "Android SDK Platform-Tools".');
    process.exit(1);
  }

  // Happy path — at least one device or emulator already attached.
  const existing = listDevices(adbBin);
  if (existing.length > 0) {
    log(`Found connected device(s): ${existing.join(', ')} — skipping boot.`);
    process.exit(0);
  }

  // Need to boot one. Find an AVD to use.
  if (!existsSync(emulatorBin)) {
    log(`emulator binary not found at ${emulatorBin}.`);
    log('Open Android Studio → SDK Manager → SDK Tools and install "Android Emulator".');
    process.exit(1);
  }

  const avds = listAvds(emulatorBin);
  if (avds.length === 0) {
    log('No AVDs configured.');
    log('Open Android Studio → Device Manager → Create Device, then re-run this command.');
    process.exit(1);
  }

  const target = process.env.ETHORA_AVD || avds[0];
  if (!avds.includes(target)) {
    log(`Requested AVD "${target}" (from ETHORA_AVD) not in available list: ${avds.join(', ')}.`);
    process.exit(1);
  }

  log(`No device attached. Booting AVD: ${target} (other AVDs: ${avds.filter((a) => a !== target).join(', ') || 'none'})...`);

  const child = spawn(emulatorBin, ['-avd', target], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll for boot. First wait for adb to see the device, then wait
  // for sys.boot_completed=1 (device fully booted, services up).
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastStatus = 'starting';
  while (Date.now() < deadline) {
    const devices = listDevices(adbBin);
    if (devices.length > 0) {
      if (lastStatus === 'starting') {
        log(`Device online (${devices[0]}), waiting for boot to complete...`);
        lastStatus = 'booting';
      }
      if (isBooted(adbBin)) {
        log(`AVD booted. Proceeding with build.`);
        process.exit(0);
      }
    }
    sleep(POLL_INTERVAL_MS);
  }

  log(`Timed out after ${BOOT_TIMEOUT_MS / 1000}s waiting for ${target} to boot.`);
  log('Open the emulator manually (Android Studio → Device Manager), wait for it to finish booting, and re-run.');
  process.exit(1);
})();
