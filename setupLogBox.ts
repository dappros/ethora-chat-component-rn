/**
 * Testbed-only LogBox configuration. Imported FIRST from index.js — before
 * `App` and therefore before expo-av / styled-components evaluate — so the
 * known-benign warnings those emit at IMPORT time are suppressed before
 * they can flash the "Open debugger to view warnings" toast. (Registering
 * these inside a component module ran after that module's own imports, too
 * late, so the toast still appeared.)
 *
 * We deliberately DON'T `ignoreAllLogs` — unexpected errors should still
 * surface their red overlay during development. The in-app Logs tab keeps
 * a full record regardless (see src/utils/devLogger).
 */
import { LogBox } from 'react-native';

LogBox.ignoreLogs([
  // No-op promise rejection from createTimeoutPromise during XMPP connect
  // teardown (also fixed at the source + via the rejection tracker).
  /\[ethora-rn\] (Hermes unhandled rejection|UNHANDLED PROMISE)/,
  /Expo AV has been deprecated/,
  /\[styled-components\/native\]/,
  /Expected style .* to contain units/,
]);
