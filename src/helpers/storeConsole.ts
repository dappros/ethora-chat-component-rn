import { RootState, store } from '../roomStore';

/**
 * Return the current redux state. Mirrors web `useStoreConsole`.
 * Attach to `globalThis.useStoreConsole` only when
 * `config.useStoreConsoleEnabled === true`; clean up otherwise.
 */
export const useStoreConsole = (): RootState => store.getState();

const g: any = globalThis as any;

const refresh = () => {
  try {
    const config = store.getState().chatSettingStore?.config;
    if (config?.useStoreConsoleEnabled === true) {
      g.useStoreConsole = useStoreConsole;
    } else if (g.useStoreConsole) {
      delete g.useStoreConsole;
    }
  } catch {
    // ignore — state may not be ready yet
  }
};

refresh();
store.subscribe(refresh);
