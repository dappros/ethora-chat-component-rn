// Expo SDK 54 metro config for the testbed. The shim list lives in
// `./metro.js` so external consumers can reuse the exact same
// resolver via `withEthoraShims(...)`.
const { getDefaultConfig } = require('expo/metro-config');
const { withEthoraShims } = require('./metro');

const config = getDefaultConfig(__dirname);
module.exports = withEthoraShims(config);
