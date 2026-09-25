/** @format */

import { useContext, useMemo, useSyncExternalStore } from 'react';
import { ReactReduxContext } from 'react-redux';
import { ThemeContext } from 'styled-components/native';
import type { RootState } from '../roomStore';
import { resolveTheme, type ChatTheme } from '../theme/theme';

const noSubscribe = () => () => {};

/**
 * Effective palette for the current config (light or dark).
 *
 * Source order:
 *   1. the styled-components ThemeProvider mounted by ReduxWrapper (same
 *      object every styled template sees);
 *   2. otherwise `config` from the redux store, when a Provider is present
 *      (components rendered under a bare <Provider> in tests / hosts);
 *   3. otherwise the light defaults.
 * Never throws outside a provider, so leaf components stay renderable in
 * isolation.
 */
export const useTheme = (): ChatTheme => {
  const styledTheme = useContext(ThemeContext) as ChatTheme | undefined;
  const reduxCtx = useContext(ReactReduxContext);
  const store = reduxCtx?.store;

  const config = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    () =>
      store
        ? (store.getState() as RootState).chatSettingStore.config
        : undefined,
    () => undefined
  );

  return useMemo(
    () => (styledTheme && 'statusBarStyle' in styledTheme ? styledTheme : resolveTheme(config)),
    [styledTheme, config]
  );
};
