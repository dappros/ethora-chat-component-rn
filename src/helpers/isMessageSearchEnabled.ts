import type { IConfig } from '../types/types';

/**
 * Single gate for every message search entry point (header button, chat
 * profile row, the search screen and its request).
 *
 * Search is opt-in: it needs `enableMessageSearch: true` and an `appId` (the
 * archive it queries is scoped by app). The deprecated `disableMessageSearch`
 * is still honoured as a hard off.
 */
export const isMessageSearchEnabled = (
  config?: Pick<IConfig, 'enableMessageSearch' | 'disableMessageSearch' | 'appId'> | null
): boolean =>
  Boolean(config?.enableMessageSearch) &&
  Boolean(config?.appId) &&
  !config?.disableMessageSearch;

export default isMessageSearchEnabled;
