import http, { setBaseURL } from '../networking/apiClient';
import { loginViaJwt } from '../networking/api-requests/auth.api';
import { getMyUser } from '../networking/api-requests/user.api';
import { IConfig, User } from '../types/types';
import { store } from '../roomStore';
import { setUser } from '../roomStore/chatSettingsSlice';
import { walletToUsername } from './walletUsername';
import { asyncLocalStorage } from '../hooks/useLocalStorage';
import { localStorageConstants } from './constants/LOCAL_STORAGE';

interface ResolveInitBeforeLoadUserOptions {
  config?: IConfig;
  signal?: AbortSignal;
}

interface HttpLikeError {
  response?: { status?: number };
  message?: string;
}

const getStatusCode = (error: unknown): number | null => {
  const status = (error as HttpLikeError)?.response?.status;
  return typeof status === 'number' ? status : null;
};

const isAuthError = (error: unknown): boolean => {
  const code = getStatusCode(error);
  return code === 401 || code === 403;
};

const isAbortError = (error: unknown): boolean => {
  const message = (error as HttpLikeError)?.message || '';
  return typeof message === 'string' && message.toLowerCase().includes('abort');
};

const hasXmppCredentials = (user?: Partial<User> | null): boolean =>
  Boolean(
    user?.xmppPassword &&
      (user?.xmppUsername || user?.defaultWallet?.walletAddress)
  );

const normalizeUserForXmpp = (user?: User | null): User | null => {
  if (!user) {return null;}
  const normalizedXmppUsername =
    user.xmppUsername || walletToUsername(user?.defaultWallet?.walletAddress || '');
  return { ...user, xmppUsername: normalizedXmppUsername };
};

const refreshWithToken = async (refreshToken: string) => {
  const response = await http.post(
    '/users/login/refresh',
    {},
    { headers: { Authorization: refreshToken } }
  );
  return {
    token: response?.data?.token || '',
    refreshToken: response?.data?.refreshToken || refreshToken,
  };
};

const mergeUsers = (base?: User | null, patch?: User | null): User | null => {
  if (!base && !patch) {return null;}
  return {
    ...(base || ({} as User)),
    ...(patch || ({} as User)),
    defaultWallet: {
      walletAddress:
        patch?.defaultWallet?.walletAddress ||
        base?.defaultWallet?.walletAddress ||
        '',
    },
  } as User;
};

const tryHydrateViaMy = async (
  candidate: User,
  myEndpoint?: string,
  signal?: AbortSignal
): Promise<User | null> => {
  if (signal?.aborted) {return null;}

  const mergedCandidate = normalizeUserForXmpp(candidate);

  if (!candidate?.token && !candidate?.refreshToken) {
    return mergedCandidate;
  }

  let workingToken = candidate?.token || '';
  let workingRefresh = candidate?.refreshToken || '';

  const candidateWithCurrentTokens = (): User => ({
    ...candidate,
    token: workingToken || candidate.token,
    refreshToken: workingRefresh || candidate.refreshToken,
  });

  const fallbackWithCreds = (): User | null => {
    const normalized = normalizeUserForXmpp(candidateWithCurrentTokens());
    if (normalized && hasXmppCredentials(normalized)) {return normalized;}
    return null;
  };

  if (workingToken) {
    try {
      const myUser = await getMyUser({ token: workingToken, endpoint: myEndpoint });
      const merged = normalizeUserForXmpp(mergeUsers(candidate, myUser));
      if (merged) {
        merged.token = workingToken || merged.token;
        merged.refreshToken = workingRefresh || merged.refreshToken;
      }
      return merged;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {return null;}
      if (isAuthError(error)) {
        if (!workingRefresh) {return fallbackWithCreds();}
        // fall through to refresh path
      } else {
        const fallback = fallbackWithCreds();
        return fallback || null;
      }
    }
  }

  if (!workingRefresh) {return mergedCandidate;}

  try {
    const refreshed = await refreshWithToken(workingRefresh);
    workingToken = refreshed.token;
    workingRefresh = refreshed.refreshToken;

    try {
      const myUser = await getMyUser({ token: workingToken, endpoint: myEndpoint });
      const merged = normalizeUserForXmpp(
        mergeUsers(candidateWithCurrentTokens(), myUser)
      );
      if (merged) {
        merged.token = workingToken || merged.token;
        merged.refreshToken = workingRefresh || merged.refreshToken;
      }
      return merged;
    } catch (myError) {
      if (signal?.aborted || isAbortError(myError)) {return null;}
      const fallback = fallbackWithCreds();
      if (fallback) {return fallback;}
      if (isAuthError(myError)) {return null;}
      throw myError;
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {return null;}
    if (isAuthError(error)) {return null;}
    throw error;
  }
};

export const resolveInitBeforeLoadUser = async (
  options?: ResolveInitBeforeLoadUserOptions
): Promise<User | null> => {
  const { config, signal } = options || {};
  if (signal?.aborted) {return null;}

  if (config?.baseUrl) {
    setBaseURL(config.baseUrl, config.customAppToken);
  }

  const myEndpoint = config?.initBeforeLoadAuth?.myEndpoint || '/users/my';

  // Priority 1: explicit userLogin
  const explicitUser = config?.userLogin?.enabled ? config?.userLogin?.user : null;
  if (explicitUser) {
    const candidate = normalizeUserForXmpp(explicitUser);
    if (candidate && hasXmppCredentials(candidate)) {return candidate;}

    const hydrated = await tryHydrateViaMy(explicitUser, myEndpoint, signal).catch(
      () => null
    );
    if (hydrated && hasXmppCredentials(hydrated)) {return hydrated;}
    return null;
  }

  // Priority 2: customLogin function
  if (config?.customLogin?.enabled && config?.customLogin?.loginFunction) {
    try {
      const customUser = await config.customLogin.loginFunction();
      if (customUser) {
        const candidate = normalizeUserForXmpp(customUser);
        if (candidate && hasXmppCredentials(candidate)) {return candidate;}
        const hydrated = await tryHydrateViaMy(customUser, myEndpoint, signal).catch(
          () => null
        );
        if (hydrated && hasXmppCredentials(hydrated)) {return hydrated;}
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error) || isAuthError(error)) {return null;}
    }
  }

  // Priority 3: jwtLogin (legacy)
  if (config?.jwtLogin?.enabled && config?.jwtLogin?.token) {
    try {
      const jwtUser = await loginViaJwt(config.jwtLogin.token);
      const normalized = normalizeUserForXmpp(jwtUser);
      if (normalized && hasXmppCredentials(normalized)) {return normalized;}
    } catch (error) {
      if (signal?.aborted || isAbortError(error) || isAuthError(error)) {return null;}
      throw error;
    }
  }

  // Priority 4: redux store user (in-memory hot path)
  const currentUser = store.getState().chatSettingStore.user;
  if (currentUser?.token || currentUser?.refreshToken || currentUser?.xmppPassword) {
    const hydrated = await tryHydrateViaMy(currentUser as User, myEndpoint, signal).catch(
      () => null
    );
    if (hydrated && hasXmppCredentials(hydrated)) {return hydrated;}
  }

  // Priority 5: persisted user in AsyncStorage
  try {
    const storedUser = await asyncLocalStorage<User>(localStorageConstants.ETHORA_USER).get();
    if (storedUser && (storedUser.token || storedUser.refreshToken || storedUser.xmppPassword)) {
      const hydrated = await tryHydrateViaMy(storedUser, myEndpoint, signal).catch(
        () => null
      );
      if (hydrated && hasXmppCredentials(hydrated)) {return hydrated;}
      await asyncLocalStorage(localStorageConstants.ETHORA_USER).remove();
    }
  } catch {
    // ignore storage errors
  }

  return null;
};

export const applyResolvedUserToStore = (user?: User | null) => {
  if (!user) {return;}
  store.dispatch(setUser(user));
};

export default resolveInitBeforeLoadUser;
