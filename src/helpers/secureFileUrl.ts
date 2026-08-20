import { store } from '../roomStore';
import { refreshAuthTokens } from '../networking/authRefresh';

const SECURE_FILES_HOST_PREFIX = 'secure-files.';

const FILE_TOKEN_PARAM = 'ft';

export const isSecureFileUrl = (url?: string | null): boolean => {
  if (!url) {return false;}
  const match = /^https?:\/\/(?:[^@/]+@)?([^:/?#]+)/i.exec(url);
  if (!match) {return false;}
  return match[1].toLowerCase().startsWith(SECURE_FILES_HOST_PREFIX);
};

export const appendFileToken = (
  url: string | null | undefined,
  fileToken: string | null | undefined
): string => {
  if (!url) {return '';}
  if (!fileToken || !isSecureFileUrl(url)) {return url;}

  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);

  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

  const params = query
    .split('&')
    .filter(Boolean)
    .filter((pair) => pair.split('=')[0] !== FILE_TOKEN_PARAM);

  params.push(`${FILE_TOKEN_PARAM}=${encodeURIComponent(fileToken)}`);

  return `${base}?${params.join('&')}${hash}`;
};

export const withFileToken = (url?: string | null): string =>
  appendFileToken(
    url,
    store.getState().chatSettingStore?.user?.fileToken || ''
  );

const RECOVERY_COOLDOWN_MS = 30_000;
let recoveryInFlight: Promise<boolean> | null = null;
let lastRecoveryAt = 0;

export const requestFileTokenRecovery = (): Promise<boolean> => {
  if (recoveryInFlight) {return recoveryInFlight;}

  const now = Date.now();
  if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
    return Promise.resolve(false);
  }
  lastRecoveryAt = now;

  const state = store.getState();
  const refreshConfig = state.chatSettingStore?.config?.refreshTokens;
  const user = state.chatSettingStore?.user;

  if (!refreshConfig?.enabled) {return Promise.resolve(false);}

  const run = async (): Promise<boolean> => {
    if (!refreshConfig.refreshFunction && !user?.refreshToken) {return false;}

    const tokens = await refreshAuthTokens();
    return Boolean(tokens.fileToken);
  };

  recoveryInFlight = run()
    .catch(() => false)
    .finally(() => {
      recoveryInFlight = null;
    });

  return recoveryInFlight;
};

export const __resetFileTokenRecoveryForTests = (): void => {
  recoveryInFlight = null;
  lastRecoveryAt = 0;
};
