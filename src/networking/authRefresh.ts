import http from './apiClient';
import { store } from '../roomStore';
import { refreshTokens } from '../roomStore/chatSettingsSlice';
import { asyncLocalStorage } from '../hooks/useLocalStorage';
import { localStorageConstants } from '../helpers/constants/LOCAL_STORAGE';
import { pushLog } from '../utils/devLogger';
import { User } from '../types/types';

/**
 * THE single refresh-token rotation point for the SDK.
 *
 * The backend now runs refresh-token ROTATION with REUSE DETECTION:
 * every successful `/users/login/refresh` burns the presented refresh
 * token and issues a new one. Presenting an already-rotated token is
 * indistinguishable, server-side, from a stolen token — so it is
 * treated as theft and (once the backend leaves monitor mode and
 * enables enforcing mode) kills the whole token family.
 *
 * That puts three hard obligations on the client:
 *
 *   1. Persist the NEW refreshToken from every response, immediately,
 *      before any other logic can throw and drop it on the floor.
 *   2. Never rotate concurrently. Two parallel refreshes both start
 *      from the same token; the loser presents a burned one and looks
 *      like an attacker. React Native is single-process, so a shared
 *      in-flight promise is the whole lock — no Web Locks needed (the
 *      web build of this component does need them, see its own
 *      `authRefresh.ts`).
 *   3. Route EVERY refresh path through here. One "side" refresh
 *      elsewhere in the codebase breaks the scheme for everyone.
 *
 * Callers must also stop treating 401 as "log out". Two of the four
 * refresh error codes are race signals, not auth failures — see
 * `RefreshErrorCode` below and `RefreshFatalError`.
 */

export type RefreshErrorCode =
  | 'REFRESH_IN_PROGRESS'
  | 'REFRESH_TOKEN_ALREADY_ROTATED'
  | 'REFRESH_TOKEN_REUSE_DETECTED'
  | 'REFRESH_TOKEN_NOT_FOUND';

export interface RefreshResult {
  token: string;
  refreshToken: string;
  /**
   * Present in the backend response but not currently consumed
   * anywhere in the SDK. Passed through so callers can use it without
   * a second round trip.
   * TODO(phase-7): decide whether to persist this on `User`.
   */
  wsToken?: string;
}

/**
 * Thrown when the session is genuinely dead and the caller must do a
 * hard logout (clear storage, drop XMPP, send the user to login).
 *
 * Anything else this module rejects with — network errors, 5xx, an
 * unrecognised 401 — is NOT fatal and must NOT trigger a logout.
 */
export class RefreshFatalError extends Error {
  code: RefreshErrorCode;

  constructor(code: RefreshErrorCode, message?: string) {
    super(message || `Refresh failed: ${code}`);
    this.name = 'RefreshFatalError';
    this.code = code;
    // Required for `instanceof` to survive TS's ES5 class-extends-builtin
    // downlevelling, which RN's babel preset still applies.
    Object.setPrototypeOf(this, RefreshFatalError.prototype);
  }
}

export const isRefreshFatalError = (
  error: unknown
): error is RefreshFatalError =>
  error instanceof RefreshFatalError ||
  (error as RefreshFatalError)?.name === 'RefreshFatalError';

const REFRESH_ENDPOINT = '/users/login/refresh';

/** `REFRESH_IN_PROGRESS` retry budget, per backend guidance (~300ms x 2-3). */
const IN_PROGRESS_MAX_ATTEMPTS = 3;
const IN_PROGRESS_BASE_DELAY_MS = 300;
/**
 * Jitter matters: after a network blip every client in the app retries
 * on the same schedule and would hammer the rotation mutex in lockstep.
 */
const IN_PROGRESS_JITTER_MS = 150;

const KNOWN_CODES: RefreshErrorCode[] = [
  'REFRESH_IN_PROGRESS',
  'REFRESH_TOKEN_ALREADY_ROTATED',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'REFRESH_TOKEN_NOT_FOUND',
];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const inProgressDelay = (attempt: number) =>
  IN_PROGRESS_BASE_DELAY_MS * attempt +
  Math.floor(Math.random() * IN_PROGRESS_JITTER_MS);

/**
 * All four codes come back as HTTP 401, so the status alone tells us
 * nothing — the code in the body is the only signal.
 *
 * TODO(backend-confirm): the exact location of `code` in the payload is
 * not documented yet. Until it is, probe every shape the API uses
 * elsewhere and take the first hit. Once confirmed, collapse this to
 * the single real path.
 */
export const parseRefreshErrorCode = (
  error: unknown
): RefreshErrorCode | null => {
  const response = (error as any)?.response;
  if (!response) {
    return null;
  }

  const data = response.data;
  const candidates = [
    data?.code,
    data?.error?.code,
    data?.errors?.[0]?.code,
    data?.error,
    data?.message,
    response.headers?.['x-error-code'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const match = KNOWN_CODES.find((code) => candidate.includes(code));
    if (match) {
      return match;
    }
  }

  return null;
};

const getStoreUser = (): Partial<User> =>
  (store.getState().chatSettingStore?.user as Partial<User>) || {};

/**
 * The refresh token as of RIGHT NOW. Read at the moment of use, never
 * captured ahead of time — that is the single-process equivalent of the
 * web build's "re-read inside the lock".
 *
 * Redux is the source of truth in RN (one process, one store);
 * AsyncStorage is only consulted as a cold-start fallback, before
 * `resolveInitBeforeLoadUser` has hydrated the store.
 */
const readCurrentRefreshToken = async (): Promise<string> => {
  const fromStore = getStoreUser().refreshToken;
  if (fromStore) {
    return fromStore;
  }

  const stored = await asyncLocalStorage<User>(
    localStorageConstants.ETHORA_USER
  ).get();
  return stored?.refreshToken || '';
};

/**
 * Persist BEFORE resolving. The dispatch updates redux (and, until
 * phase 6 lands, fires its own best-effort AsyncStorage write); the
 * awaited write below is the one that actually guarantees the rotated
 * token survives the app being killed a moment later. Losing it means
 * the next launch presents a burned token — i.e. looks like theft.
 */
const persistTokens = async (result: RefreshResult): Promise<void> => {
  store.dispatch(
    refreshTokens({
      token: result.token,
      refreshToken: result.refreshToken,
    })
  );

  try {
    // Write the post-dispatch snapshot rather than a read-modify-write
    // merge, so this can't race the reducer's own write back to a
    // stale copy of the surrounding user fields.
    await asyncLocalStorage<User>(localStorageConstants.ETHORA_USER).set(
      store.getState().chatSettingStore.user as User
    );
  } catch (error) {
    pushLog('warn', 'authRefresh: failed to persist rotated tokens', error);
  }
};

/**
 * A rotation that happened somewhere we didn't drive — currently only
 * reachable via the ALREADY_ROTATED recovery path, kept separate so the
 * web build and this one stay structurally identical.
 */
const adoptStoredTokens = async (): Promise<RefreshResult | null> => {
  const stored = await asyncLocalStorage<User>(
    localStorageConstants.ETHORA_USER
  ).get();
  if (!stored?.refreshToken || !stored?.token) {
    return null;
  }

  const user = getStoreUser();
  if (user.refreshToken !== stored.refreshToken) {
    store.dispatch(
      refreshTokens({
        token: stored.token,
        refreshToken: stored.refreshToken,
      })
    );
  }

  return { token: stored.token, refreshToken: stored.refreshToken };
};

/** Host-supplied rotation, mirrors `IConfig['refreshTokens']['refreshFunction']`. */
type ConsumerRefreshFn = () => Promise<{
  accessToken: string;
  refreshToken?: string;
} | null>;

const runConsumerRefresh = async (
  refreshFunction: ConsumerRefreshFn
): Promise<RefreshResult> => {
  const refreshed = await refreshFunction();

  if (!refreshed?.accessToken) {
    throw new Error('Custom refresh function did not return an access token');
  }

  if (!refreshed.refreshToken) {
    // Not fatal — some hosts still run non-rotating backends — but on a
    // rotating one this silently keeps a burned token around, which is
    // exactly the failure the new scheme punishes.
    pushLog(
      'warn',
      'authRefresh: custom refreshFunction returned no refreshToken; ' +
        'keeping the existing one. On a rotating backend this will be ' +
        'seen as token reuse.'
    );
  }

  const result: RefreshResult = {
    token: refreshed.accessToken,
    refreshToken:
      refreshed.refreshToken || (await readCurrentRefreshToken()) || '',
  };

  await persistTokens(result);
  return result;
};

const requestRotation = async (
  refreshToken: string
): Promise<RefreshResult> => {
  const response = await http.post(
    REFRESH_ENDPOINT,
    {},
    { headers: { Authorization: refreshToken } }
  );

  const result: RefreshResult = {
    token: response?.data?.token || '',
    refreshToken: response?.data?.refreshToken || '',
    wsToken: response?.data?.wsToken,
  };

  if (!result.token || !result.refreshToken) {
    throw new Error('Refresh response did not contain both tokens');
  }

  // Persist first, resolve second. Every early return between here and
  // the caller is a chance to lose the rotation.
  await persistTokens(result);
  return result;
};

const performRefresh = async (
  overrideToken?: string
): Promise<RefreshResult> => {
  const consumerRefresh =
    store.getState().chatSettingStore?.config?.refreshTokens?.refreshFunction;

  if (consumerRefresh) {
    // A configured host function wins unconditionally — including over
    // an explicit bootstrap token. Hosts that embed this SDK often own
    // the Ethora refresh token themselves (their own storage, their own
    // rotation) and only hand us a copy; rotating it here would burn
    // THEIR token behind their back and leave them holding a dead one.
    //
    // It still has to be serialised — it hits the same backend mutex —
    // hence running it inside the shared in-flight promise.
    return runConsumerRefresh(consumerRefresh);
  }

  for (let attempt = 1; attempt <= IN_PROGRESS_MAX_ATTEMPTS; attempt++) {
    const refreshToken = overrideToken || (await readCurrentRefreshToken());

    if (!refreshToken) {
      // Deliberately NOT fatal: a missing token mid-bootstrap must not
      // nuke a session that is still being hydrated.
      throw new Error('Refresh token is missing');
    }

    try {
      return await requestRotation(refreshToken);
    } catch (error) {
      const code = parseRefreshErrorCode(error);

      if (code === 'REFRESH_IN_PROGRESS') {
        if (attempt < IN_PROGRESS_MAX_ATTEMPTS) {
          await sleep(inProgressDelay(attempt));
          continue;
        }
        // Budget spent. Whoever holds the mutex has very likely
        // finished and written a newer token — take it if so. Skipped
        // for an explicit token: it may belong to a different session
        // than whatever is currently in storage.
        const adopted = overrideToken ? null : await adoptStoredTokens();
        if (adopted && adopted.refreshToken !== refreshToken) {
          return adopted;
        }
        throw error;
      }

      if (code === 'REFRESH_TOKEN_ALREADY_ROTATED') {
        // Our copy is stale. If something already wrote a newer token,
        // this is a benign race — use it. Otherwise the session really
        // is unrecoverable.
        const adopted = overrideToken ? null : await adoptStoredTokens();
        if (adopted && adopted.refreshToken !== refreshToken) {
          return adopted;
        }
        throw new RefreshFatalError(code);
      }

      if (
        code === 'REFRESH_TOKEN_REUSE_DETECTED' ||
        code === 'REFRESH_TOKEN_NOT_FOUND'
      ) {
        throw new RefreshFatalError(code);
      }

      // Network error, 5xx, plain 401 without a code — pass through
      // untouched. The caller must not log out on these.
      throw error;
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new Error('Refresh attempts exhausted');
};

export interface RefreshOptions {
  /**
   * Rotate THIS token instead of the one in the store/storage.
   *
   * Only for bootstrap, where the session being restored isn't in the
   * store yet (a host-supplied `userLogin.user`, a persisted record).
   * Everywhere else, omitting it is the correct and safer choice: the
   * module then always presents the newest token it knows about.
   */
  refreshToken?: string;
}

let inflight: Promise<RefreshResult> | null = null;

/**
 * Rotate the tokens. Concurrent callers share ONE request — this is the
 * lock the new backend scheme requires.
 *
 * Rejects with `RefreshFatalError` when the session is dead (caller
 * should hard-logout) and with a plain error otherwise (caller should
 * surface the failure and leave the session alone).
 */
export function refreshAuthTokens(
  options?: RefreshOptions
): Promise<RefreshResult> {
  if (inflight) {
    // Whatever that rotation produces is at least as fresh as anything
    // this caller could have asked for.
    return inflight;
  }

  inflight = performRefresh(options?.refreshToken).finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Fire-and-forget variant for call sites that only want "make sure the
 * tokens are fresh" and have no meaningful error handling — chat
 * bootstrap, XMPP reconnect. Never rejects.
 */
export async function refreshAuthTokensQuietly(): Promise<RefreshResult | null> {
  try {
    return await refreshAuthTokens();
  } catch (error) {
    pushLog(
      isRefreshFatalError(error) ? 'error' : 'warn',
      'authRefresh: background refresh failed',
      error
    );
    return null;
  }
}

/** Test seam — drops any shared in-flight promise between cases. */
export function __resetAuthRefreshStateForTests(): void {
  inflight = null;
}
