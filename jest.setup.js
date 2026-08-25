// Global mocks for jest. The chat component depends on a few RN
// modules + the AsyncStorage native module; provide test doubles so the
// unit + integration tests run inside node.

// `react-native-get-random-values` polyfills `global.crypto.getRandomValues`
// via a native module bridge that doesn't exist under Jest's Node
// environment. The real app gets it from that package (imported at the
// very top of `main.ts`/`index.js`); tests get the same global filled in
// with Node's own CSPRNG instead, so `persistCrypto.ts`'s key/IV
// generation exercises real randomness rather than a mock.
if (!global.crypto) {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  const nodeCrypto = require('crypto');
  global.crypto.getRandomValues = (typedArray) => {
    const bytes = nodeCrypto.randomBytes(typedArray.length);
    typedArray.set(bytes);
    return typedArray;
  };
}

// expo-secure-store: this repo's own devDependency (added so the test
// harness can exercise real Keychain/Keystore storage on-device), but
// under Jest there's no native module bridge — back it with an in-memory
// Map so secureUserStorage/persistCrypto tests see real persistence
// semantics without touching the OS keychain.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
    __store: store,
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// NetInfo: addEventListener returns an unsubscribe and never fires in
// tests (the provider's reconnect-on-restore effect stays inert).
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() =>
      Promise.resolve({ isConnected: true, isInternetReachable: true })
    ),
  },
}));

// Native deps that this repo references but doesn't install — provide
// generic mocks so tests touching those imports can still run.
const passthroughFC = () => null;
jest.mock(
  'react-native-svg',
  () => {
    const fn = passthroughFC;
    return new Proxy({}, { get: () => fn });
  },
  { virtual: true }
);
jest.mock('react-native-reanimated', () => {
  try {
    return require('react-native-reanimated/mock');
  } catch {
    return {};
  }
});
jest.mock('@react-native-clipboard/clipboard', () => ({}), { virtual: true });
jest.mock('react-native-fs', () => ({}), { virtual: true });
jest.mock('react-native-video', () => 'Video', { virtual: true });
jest.mock('react-native-image-picker', () => ({}), { virtual: true });
jest.mock('react-native-image-crop-picker', () => ({}), { virtual: true });
jest.mock('react-native-permissions', () => ({}), { virtual: true });
jest.mock('react-native-document-picker', () => ({}), { virtual: true });
jest.mock('react-native-audio-recorder-player', () => ({}), { virtual: true });
jest.mock('react-native-emoji-selector', () => 'EmojiSelector', {
  virtual: true,
});
jest.mock('@react-native-camera-roll/camera-roll', () => ({}), {
  virtual: true,
});
jest.mock('@react-native-community/checkbox', () => 'CheckBox', {
  virtual: true,
});
jest.mock('react-native-qrcode-svg', () => 'QRCode', { virtual: true });


// Silence noisy console.warn from the xmpp client init in unit tests.
const origWarn = console.warn;
console.warn = (...args) => {
  const first = String(args[0] || '');
  if (
    first.includes('setVCardStanza') ||
    first.includes('sendMessageReactionStanza') ||
    first.includes('not implemented in RN xmpp client') ||
    first.includes('createPrivateRoomStanza')
  ) {
    return;
  }
  origWarn(...args);
};
