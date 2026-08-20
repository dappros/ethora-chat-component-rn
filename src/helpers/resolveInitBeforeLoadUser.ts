import { setBaseURL } from '../networking/apiClient';
import { refreshAuthTokens, isRefreshFatalError } from '../networking/authRefresh';
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

/**
 * Bootstrap rotation.
 *
 * Was a second, independent `/users/login/refresh` caller that bypassed
 * every lock in the SDK — and, worse, only wrote the rotated token to
 * the store on the happy path, so several of the early-return branches
 * below used to drop it. Under the backend's reuse detection a dropped
 * rotation means the next launch presents a burned token and the
 * session is killed.
 *
 * `refreshAuthTokens` persists the new pair before it resolves, so by
 * the time this returns the rotation is safe no matter which branch the
 * caller takes afterwards. The explicit token is required here: during
 * bootstrap the candidate session isn't in the store yet.
 */
const refreshWithToken = async (refreshToken: string) => {
  const result = await refreshAuthTokens({ refreshToken });
  return {
    token: result.token,
    refreshToken: result.refreshToken || refreshToken,
    xmppPassword: result.xmppPassword || '',
    fileToken: result.fileToken || '',
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
  let rotatedXmppPassword = '';
  let workingFileToken = candidate?.fileToken || '';

  const candidateWithCurrentTokens = (): User => ({
    ...candidate,
    token: workingToken || candidate.token,
    refreshToken: workingRefresh || candidate.refreshToken,
    xmppPassword: rotatedXmppPassword || candidate.xmppPassword,
    fileToken: workingFileToken || candidate.fileToken,
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
        merged.xmppPassword = rotatedXmppPassword || merged.xmppPassword;
        merged.fileToken = workingFileToken || merged.fileToken;
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
    rotatedXmppPassword = refreshed.xmppPassword || rotatedXmppPassword;
    workingFileToken = refreshed.fileToken || workingFileToken;

    try {
      const myUser = await getMyUser({ token: workingToken, endpoint: myEndpoint });
      const merged = normalizeUserForXmpp(
        mergeUsers(candidateWithCurrentTokens(), myUser)
      );
      if (merged) {
        merged.token = workingToken || merged.token;
        merged.refreshToken = workingRefresh || merged.refreshToken;
        merged.xmppPassword = rotatedXmppPassword || merged.xmppPassword;
        merged.fileToken = workingFileToken || merged.fileToken;
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
    // A fatal refresh verdict (reuse detected / token not found / stale
    // with nothing newer around) carries no HTTP response, so it would
    // otherwise fall through to `throw` — the session is simply dead,
    // which for bootstrap means "nothing to restore".
    if (isRefreshFatalError(error)) {return null;}
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

/**
 * Re-mints a User with a fresh xmppPassword for the XMPP credentials-
 * provider path (bug #17). Unlike `resolveInitBeforeLoadUser` this
 * ALWAYS hydrates via the chosen auth path even if the cached user
 * already had xmppCredentials — that's the whole point, the old ones
 * are stale.
 *
 * Selection order:
 *   1. `jwtLogin` — re-exchange the JWT via `/users/client`.
 *   2. Anything else (`userLogin` / `customLogin` / store / persisted)
 *      — `tryHydrateViaMy` on the current user, which calls
 *      `/users/my` and, on 401, refreshes the access token via
 *      `/users/login/refresh` and retries.
 *
 * Returns `null` only when nothing usable is available — the caller
 * (xmppProvider) falls back to the cached creds in that case.
 */
export const refreshUserCredentialsForXmpp = async (
  config?: IConfig,
  signal?: AbortSignal
): Promise<User | null> => {
  if (signal?.aborted) {return null;}

  // Priority 1: jwtLogin — same path as `resolveInitBeforeLoadUser`
  // priority 3. We always re-exchange because the original JWT may
  // itself have expired (and the consumer is expected to swap
  // `config.jwtLogin.token` for a fresh one before then).
  if (config?.jwtLogin?.enabled && config?.jwtLogin?.token) {
    try {
      const fresh = await loginViaJwt(config.jwtLogin.token);
      const normalized = normalizeUserForXmpp(fresh);
      if (normalized && hasXmppCredentials(normalized)) {return normalized;}
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {return null;}
      // fall through to /users/my path
    }
  }

  const myEndpoint = config?.initBeforeLoadAuth?.myEndpoint || '/users/my';

  // Priority 2: redux store user (covers userLogin + customLogin +
  // anything previously persisted into chatSettingStore.user). The
  // user must have at least a refreshToken for the refresh chain to
  // produce something useful.
  const currentUser = store.getState().chatSettingStore.user;
  if (currentUser?.token || currentUser?.refreshToken) {
    const hydrated = await tryHydrateViaMy(
      currentUser as User,
      myEndpoint,
      signal
    ).catch(() => null);
    if (hydrated && hasXmppCredentials(hydrated)) {return hydrated;}
  }

  // Priority 3: persisted user in AsyncStorage — defensive; the store
  // should already mirror this, but if the redux state got cleared
  // mid-session (logout race) this gives us one last shot.
  try {
    const storedUser = await asyncLocalStorage<User>(
      localStorageConstants.ETHORA_USER
    ).get();
    if (
      storedUser &&
      (storedUser.token || storedUser.refreshToken || storedUser.xmppPassword)
    ) {
      const hydrated = await tryHydrateViaMy(
        storedUser,
        myEndpoint,
        signal
      ).catch(() => null);
      if (hydrated && hasXmppCredentials(hydrated)) {return hydrated;}
    }
  } catch {
    // ignore storage errors
  }

  return null;
};

export default resolveInitBeforeLoadUser;
