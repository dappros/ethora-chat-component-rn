module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: [
    'node_modules/',
    'ios/Pods/',
    'android/build/',
    'android/app/build/',
    'web/',
    '.claude/',
    'coverage/',
    'empty-shim.js',
    'dist/',
    'lib/',
  ],
  rules: {
    // Project-wide downgrades — half-ported UI code from the web side
    // is rife with these. Keep them visible (warn) but not breaking.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-unused-vars': 'off', // TS version above is the canonical one
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-shadow': 'warn',
    'no-shadow': 'off',
    'react-native/no-inline-styles': 'warn',
    'no-useless-escape': 'warn',
    'no-bitwise': 'warn',
    'no-lone-blocks': 'warn',
    'react/no-unstable-nested-components': 'warn',
    'no-catch-shadow': 'warn',
    // React 17+ JSX transform doesn't need React in scope.
    'react/react-in-jsx-scope': 'off',
  },
  overrides: [
    {
      files: ['__tests__/**/*.{ts,tsx,js,jsx}', 'jest.setup.js'],
      env: { jest: true, node: true },
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
};
