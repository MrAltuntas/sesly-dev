const expoPreset = require('jest-expo/jest-preset');

// Same babel-jest transform as jest-expo, plus a Jest-only plugin that turns
// `await import(...)` into require() (see src/test-utils/babel-plugin-jest-dynamic-import.js).
const JS_TRANSFORM_KEY = '\\.[jt]sx?$';
const [babelJest, babelJestOptions] = expoPreset.transform[JS_TRANSFORM_KEY];

module.exports = {
  preset: 'jest-expo',
  transform: {
    [JS_TRANSFORM_KEY]: [
      babelJest,
      {
        ...babelJestOptions,
        plugins: ['./src/test-utils/babel-plugin-jest-dynamic-import.js'],
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo.*|@expo/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@react-native-firebase/.*|@react-native-google-signin/.*|@react-native-async-storage/.*|react-native-encrypted-storage|react-native-gesture-handler|react-native-keyboard-controller|react-native-toast-message|react-native-markdown-display|react-native-worklets|react-native-reanimated|react-native-screens|react-native-safe-area-context|react-native-svg|mobx|mobx-react-lite|socket.io-client)/)'
  ],
  // mobx-react-lite's CJS build batches through react-dom; the ES build picks
  // reactBatchedUpdates.native.js (react-native) like Metro does.
  moduleNameMapper: {
    '^mobx-react-lite$': '<rootDir>/node_modules/mobx-react-lite/es/index.js',
  },
  setupFilesAfterEnv: ['./src/test-utils/setup.ts'],
  // Cold-cache screen renders under a parallel run can exceed the 5 s default.
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  collectCoverageFrom: [
    'App.tsx',
    'src/**/*.{ts,tsx}',
    'src/boot/**/*.{ts,tsx}',
    'modules/*/index.ts',
    '!src/**/*.d.ts',
    '!src/test-utils/**',
    // Pure re-export barrels (no logic). Every other index file is measured,
    // src/i18n/index.ts among them.
    '!src/screens/*/index.ts',
    '!src/hooks/index.ts',
    '!src/components/voiceflow/index.ts',
    '!src/components/design/index.tsx',
  ],
  // Enforced by `npm run test:cov` (any run with --coverage). Two points
  // below the release-pass measurement of 2026-10-19 (97.87 / 93.81 / 97.70 /
  // 98.87, truncated to one decimal). Raise them as coverage grows; never
  // lower them to make CI pass.
  coverageThreshold: {
    global: {
      statements: 95.8,
      branches: 91.8,
      functions: 95.7,
      lines: 96.8,
    },
  },
};
