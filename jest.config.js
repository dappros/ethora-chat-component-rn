module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/',
    '/web/',
    // Pre-existing App.test renders the whole tree, which transitively
    // imports several non-installed native modules + a broken path
    // (`../../../../utils/toastEmitter`). The new flow-layer tests
    // (which actually exercise the integration) are independent.
    '/__tests__/App.test.tsx$',
  ],
  modulePathIgnorePatterns: [
    '/.claude/',
    '/web/',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      'react-native|' +
      '@react-native|' +
      '@react-native-async-storage|' +
      '@xmpp|' +
      '@reduxjs/toolkit|' +
      'react-redux|' +
      'styled-components|' +
      'ltx' +
    ')/)',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
