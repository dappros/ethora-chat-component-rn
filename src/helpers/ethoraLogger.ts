// Verbose console output is on in development builds (React Native's
// `__DEV__`) and, in release builds, only when the host set
// `config.useStoreConsoleEnabled`. The store is read lazily so this module
// can be imported from the reducer graph without an import cycle.
const isVerboseConsoleEnabled = (): boolean => {
  if (typeof __DEV__ !== 'undefined' && __DEV__ === true) {
    return true;
  }
  try {
    const { store } = require('../roomStore');
    return (
      store.getState().chatSettingStore?.config?.useStoreConsoleEnabled === true
    );
  } catch {
    return false;
  }
};

export const ethoraLogger = {
  log: (...args: unknown[]) => {
    if (isVerboseConsoleEnabled()) {
      console.log(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (isVerboseConsoleEnabled()) {
      console.info(...args);
    }
  },
  debug: (...args: unknown[]) => {
    if (isVerboseConsoleEnabled()) {
      console.debug(...args);
    }
  },
  error: (...args: unknown[]) => {
    if (isVerboseConsoleEnabled()) {
      console.error(...args);
    }
  },
  always: (...args: unknown[]) => {
    console.log(...args);
  },
  /**
   * For failures that must never be silent, whatever the verbose-console
   * setting is.
   */
  criticalError: (...args: unknown[]) => {
    console.error(...args);
  },
};
