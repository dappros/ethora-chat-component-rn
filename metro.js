/**
 * Metro helper for consumers of @ethora/chat-component.
 *
 * The chat library statically references several optional native
 * modules (image-crop-picker, document-picker, audio-recorder,
 * permissions, clipboard, etc.) so feature flags can flip them on
 * without dynamic-import gymnastics. Consumers who don't enable
 * those features still need Metro to resolve the imports — this
 * helper points them at a noop shim.
 *
 * Usage:
 *
 *   // metro.config.js
 *   const { getDefaultConfig } = require('expo/metro-config');
 *   const { withEthoraShims } = require('@ethora/chat-component/metro');
 *
 *   module.exports = withEthoraShims(getDefaultConfig(__dirname));
 *
 * If you DO install one of the listed modules in your app, drop it
 * from `OPTIONAL_NATIVE_MODULES` (or pass `{ skip: [...] }`).
 */

const path = require('path');

const OPTIONAL_NATIVE_MODULES = [
  'react-native-image-crop-picker',
  'react-native-document-picker',
  'react-native-image-picker',
  'react-native-audio-recorder-player',
  'react-native-fs',
  'react-native-video',
  'react-native-permissions',
  '@react-native-clipboard/clipboard',
  'react-native-emoji-selector',
  '@react-native-camera-roll/camera-roll',
  '@react-native-community/checkbox',
  'react-native-qrcode-svg',
  'emoji-mart',
  'luxon',
  'react-native-pdf',
  'react-native-image-zoom-viewer',
  'react-native-blob-util',
  'react-native-haptic-feedback',
  'rn-fetch-blob',
  'react-native-share',
];

const SHIM_PATH = path.resolve(__dirname, 'empty-shim.js');

function withEthoraShims(config, { skip = [] } = {}) {
  const skipSet = new Set(skip);
  const shims = OPTIONAL_NATIVE_MODULES.filter((m) => !skipSet.has(m));
  const lookup = new Set(shims);

  const previousResolveRequest =
    config.resolver && config.resolver.resolveRequest;

  config.resolver = config.resolver || {};
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (lookup.has(moduleName)) {
      return { filePath: SHIM_PATH, type: 'sourceFile' };
    }
    if (previousResolveRequest) {
      return previousResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };

  return config;
}

module.exports = { withEthoraShims, OPTIONAL_NATIVE_MODULES };
