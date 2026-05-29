// Global mocks for jest. The chat component depends on a few RN
// modules + the AsyncStorage native module; provide test doubles so the
// unit + integration tests run inside node.

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
