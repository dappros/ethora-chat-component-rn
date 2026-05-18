module.exports = {
  preset: 'jest-expo',
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
      'expo|' +
      'expo-modules-core|' +
      '@expo|' +
      'expo-status-bar|' +
      '@xmpp|' +
      '@reduxjs/toolkit|' +
      'react-redux|' +
      'styled-components|' +
      'ltx' +
    ')/)',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // immer's package.json exposes an ESM build via its `react-native`
  // export field (`dist/immer.legacy-esm.js`), which jest-expo's
  // resolver picks up because this is an RN project — but Jest can't
  // parse `export {}` without transforming it. Redirect imports of
  // bare `immer` to its CJS build, which Jest reads natively. Without
  // this every test file that imports a redux slice (transitively
  // pulling in @reduxjs/toolkit → immer) fails at parse time with
  // "SyntaxError: Unexpected token 'export'".
  moduleNameMapper: {
    '^immer$': '<rootDir>/node_modules/immer/dist/cjs/index.js',
  },
};
