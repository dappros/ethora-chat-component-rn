/**
 * Metro helper for consumers of @ethora/chat-component-rn.
 *
 * **As of 26.5.5 this helper is a no-op.** The SDK no longer
 * statically imports any "optional native modules" — what used to be
 * web-port artefacts (`emoji-mart`, `react-native-pdf`,
 * `react-native-image-zoom-viewer`, `react-native-haptic-feedback`,
 * `react-native-share`, ...) is gone, and what used to be RN-legacy
 * pickers (`react-native-image-crop-picker`,
 * `react-native-document-picker`, `react-native-permissions`,
 * `react-native-audio-recorder-player`, `react-native-emoji-selector`,
 * `@react-native-clipboard/clipboard`,
 * `@react-native-community/checkbox`) has been replaced with the
 * matching Expo modules + a small RN-native checkbox.
 *
 * The export is preserved so older `metro.config.js` setups don't
 * break — calling `withEthoraShims(config)` simply returns the config
 * unchanged.
 */

const OPTIONAL_NATIVE_MODULES = [];

function withEthoraShims(config /*, _options */) {
  return config;
}

module.exports = { withEthoraShims, OPTIONAL_NATIVE_MODULES };
