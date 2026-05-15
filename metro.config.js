// Expo SDK 54 metro config. The previous bare-RN config used
// `@react-native/metro-config`; with Expo we use `expo/metro-config`
// which already wires up the bare flow + Hermes + asset resolution.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Native modules that the chat source tree imports statically but the
// testbed never actually invokes. Without these shims metro fails to
// bundle because the packages aren't installed. Install the real
// packages (or the Expo equivalents like expo-image-picker /
// expo-document-picker / expo-clipboard) if/when the UI that uses
// them goes live.
const shim = path.resolve(__dirname, 'empty-shim.js');
const NATIVE_SHIMS = {
  'react-native-image-crop-picker': shim,
  'react-native-document-picker': shim,
  'react-native-image-picker': shim,
  'react-native-audio-recorder-player': shim,
  'react-native-fs': shim,
  'react-native-video': shim,
  'react-native-permissions': shim,
  '@react-native-clipboard/clipboard': shim,
  'react-native-emoji-selector': shim,
  '@react-native-camera-roll/camera-roll': shim,
  '@react-native-community/checkbox': shim,
  'react-native-qrcode-svg': shim,
  'emoji-mart': shim,
  luxon: shim,
  'react-native-pdf': shim,
  'react-native-image-zoom-viewer': shim,
  'react-native-blob-util': shim,
  'react-native-haptic-feedback': shim,
  'rn-fetch-blob': shim,
  'react-native-share': shim,
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (Object.prototype.hasOwnProperty.call(NATIVE_SHIMS, moduleName)) {
    return { filePath: NATIVE_SHIMS[moduleName], type: 'sourceFile' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
