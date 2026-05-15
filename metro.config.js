const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Optional native modules that the source tree imports statically but
// the testbed never invokes. Without these shims metro fails to bundle.
// Install the real packages if/when the UI that uses them goes live.
const shim = path.resolve(__dirname, 'empty-shim.js');
// react-native-svg needs a React-aware shim: the generic Proxy
// returns truthy for `Component.prototype.isReactComponent`, which
// makes React treat every SVG primitive as a class component and
// emit a wall of validateClassInstance warnings. The svg shim exports
// plain function components that render null.
const svgShim = path.resolve(__dirname, 'empty-svg-shim.js');
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
  'react-native-svg': svgShim,
  'emoji-mart': shim,
  // pure-JS optional deps the UI pulls in but the testbed doesn't use
  luxon: shim,
  'react-native-pdf': shim,
  'react-native-image-zoom-viewer': shim,
  'react-native-blob-util': shim,
  'react-native-haptic-feedback': shim,
  'rn-fetch-blob': shim,
  'react-native-share': shim,
};

const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (Object.prototype.hasOwnProperty.call(NATIVE_SHIMS, moduleName)) {
        return {
          filePath: NATIVE_SHIMS[moduleName],
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
