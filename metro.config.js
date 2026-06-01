// Expo SDK 54 metro config for the testbed. The shim list lives in
// `./metro.js` so external consumers can reuse the exact same
// resolver via `withEthoraShims(...)`.
const { getDefaultConfig } = require('expo/metro-config');
const { withEthoraShims } = require('./metro');

const config = withEthoraShims(getDefaultConfig(__dirname));

// Local escape hatch: watchman intermittently crashes Metro on some macOS
// setups (`fb-watchman` spawnError → exit 7), which strands the dev
// server. Set METRO_NO_WATCHMAN=1 to fall back to Metro's Node
// file-watcher (a bit slower, but stable). Off by default so CI / other
// devs keep watchman.
if (process.env.METRO_NO_WATCHMAN === '1') {
  config.resolver.useWatchman = false;
}

module.exports = config;
