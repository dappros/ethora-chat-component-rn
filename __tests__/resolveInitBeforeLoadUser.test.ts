/** resolveInitBeforeLoadUser — priority chain. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  refreshUserCredentialsForXmpp,
  resolveInitBeforeLoadUser,
} from '../src/helpers/resolveInitBeforeLoadUser';
import { localStorageConstants } from '../src/helpers/constants/LOCAL_STORAGE';
import { store } from '../src/roomStore';
import { logout, setUser } from '../src/roomStore/chatSettingsSlice';

jest.mock('../src/networking/apiClient', () => {
  const post = jest.fn();
  const get = jest.fn();
  return {
    __esModule: true,
    default: { post, get },
    setBaseURL: jest.fn(),
  };
});

jest.mock('../src/networking/api-requests/auth.api', () => ({
  loginViaJwt: jest.fn(),
}));

jest.mock('../src/networking/api-requests/user.api', () => ({
  getMyUser: jest.fn(),
}));

const http = jest.requireMock('../src/networking/apiClient').default;
const { loginViaJwt } = jest.requireMock(
  '../src/networking/api-requests/auth.api'
);
const { getMyUser } = jest.requireMock(
  '../src/networking/api-requests/user.api'
);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  store.dispatch(logout());
});

function userWithXmppCreds(extra: any = {}) {
  return {
    walletAddress: '0xabc',
    defaultWallet: { walletAddress: '0xabc' },
    _id: 'u',
    firstName: 'A',
    lastName: 'B',
    appId: 'app',
    xmppPassword: 'pw',
    xmppUsername: '0xabc',
    token: '',
    refreshToken: '',
    ...extra,
  };
}

describe('resolveInitBeforeLoadUser', () => {
  it('returns userLogin.user immediately when it has xmpp creds', async () => {
    const user = userWithXmppCreds();
    const out = await resolveInitBeforeLoadUser({
      config: { userLogin: { enabled: true, user } as any },
    });
    expect(out?.xmppPassword).toBe('pw');
    expect(loginViaJwt).not.toHaveBeenCalled();
    expect(getMyUser).not.toHaveBeenCalled();
  });

  it('falls back to /users/my hydration when explicit user lacks xmpp creds', async () => {
    getMyUser.mockResolvedValue(userWithXmppCreds());
    const out = await resolveInitBeforeLoadUser({
      config: {
        userLogin: {
          enabled: true,
          user: { token: 't1', xmppPassword: '' } as any,
        },
      },
    });
    expect(getMyUser).toHaveBeenCalledTimes(1);
    expect(out?.xmppPassword).toBe('pw');
  });

  it('calls customLogin.loginFunction when no userLogin', async () => {
    const loginFn = jest.fn().mockResolvedValue(userWithXmppCreds());
    const out = await resolveInitBeforeLoadUser({
      config: {
        customLogin: { enabled: true, loginFunction: loginFn },
      },
    });
    expect(loginFn).toHaveBeenCalled();
    expect(out?.xmppUsername).toBe('0xabc');
    expect(loginViaJwt).not.toHaveBeenCalled();
  });

  it('uses jwtLogin when customLogin & userLogin are absent', async () => {
    loginViaJwt.mockResolvedValue(userWithXmppCreds());
    const out = await resolveInitBeforeLoadUser({
      config: { jwtLogin: { enabled: true, token: 'jwt-abc' } as any },
    });
    expect(loginViaJwt).toHaveBeenCalledWith('jwt-abc');
    expect(out?.xmppPassword).toBe('pw');
  });

  it('returns null when nothing resolves', async () => {
    const out = await resolveInitBeforeLoadUser({ config: {} });
    expect(out).toBeNull();
  });

  it('aborts cleanly when signal pre-aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await resolveInitBeforeLoadUser({
      config: { jwtLogin: { enabled: true, token: 'x' } as any },
      signal: ac.signal,
    });
    expect(out).toBeNull();
    expect(loginViaJwt).not.toHaveBeenCalled();
  });

  it('reads stored user from AsyncStorage as last fallback', async () => {
    const stored = userWithXmppCreds();
    await AsyncStorage.setItem(
      localStorageConstants.ETHORA_USER,
      JSON.stringify(stored)
    );
    const out = await resolveInitBeforeLoadUser({ config: {} });
    expect(out?.walletAddress).toBe('0xabc');
  });
});

// ---- refreshUserCredentialsForXmpp (bug #17, all modes) -------------

describe('refreshUserCredentialsForXmpp', () => {
  it('jwtLogin path: re-exchanges the JWT via /users/client (loginViaJwt)', async () => {
    loginViaJwt.mockResolvedValue(userWithXmppCreds({ xmppPassword: 'pw2' }));
    const out = await refreshUserCredentialsForXmpp({
      jwtLogin: { enabled: true, token: 'jwt-new' } as any,
    });
    expect(loginViaJwt).toHaveBeenCalledWith('jwt-new');
    expect(out?.xmppPassword).toBe('pw2');
  });

  it('userLogin path: hydrates the redux user via /users/my even when cached creds look valid', async () => {
    // userLogin mode persists the user into the redux store after
    // bootstrap; the static config-supplied user is not re-read here.
    store.dispatch(
      setUser(
        userWithXmppCreds({
          token: 'access-stale',
          refreshToken: 'refresh-1',
          xmppPassword: 'pw-stale',
        }) as any
      )
    );
    getMyUser.mockResolvedValue(
      userWithXmppCreds({ xmppPassword: 'pw-fresh' })
    );
    const out = await refreshUserCredentialsForXmpp({});
    expect(getMyUser).toHaveBeenCalledWith({
      token: 'access-stale',
      endpoint: '/v1/users/my',
    });
    expect(out?.xmppPassword).toBe('pw-fresh');
  });

  it('userLogin path: 401 on /users/my triggers REST refresh + retry', async () => {
    store.dispatch(
      setUser(
        userWithXmppCreds({
          token: 'access-expired',
          refreshToken: 'refresh-1',
          xmppPassword: 'pw-stale',
        }) as any
      )
    );
    // First /users/my call rejects with 401, second (after REST refresh)
    // succeeds with fresh xmppPassword.
    getMyUser
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce(userWithXmppCreds({ xmppPassword: 'pw-fresh' }));
    http.post.mockResolvedValueOnce({
      data: { token: 'access-new', refreshToken: 'refresh-2' },
    });

    const out = await refreshUserCredentialsForXmpp({});

    expect(getMyUser).toHaveBeenCalledTimes(2);
    // REST refresh fired with the refreshToken before the retry.
    expect(http.post).toHaveBeenCalledWith(
      '/v1/users/login/refresh',
      {},
      { headers: { Authorization: 'refresh-1' } }
    );
    expect(out?.xmppPassword).toBe('pw-fresh');
  });

  it('returns null when there is no auth material to refresh from', async () => {
    // Empty store + no jwtLogin + no persisted user.
    const out = await refreshUserCredentialsForXmpp({});
    expect(out).toBeNull();
  });

  it('respects config.initBeforeLoadAuth.myEndpoint when calling /users/my', async () => {
    store.dispatch(
      setUser(
        userWithXmppCreds({
          token: 'access',
          refreshToken: 'r',
          xmppPassword: 'pw',
        }) as any
      )
    );
    getMyUser.mockResolvedValue(
      userWithXmppCreds({ xmppPassword: 'pw-fresh' })
    );
    await refreshUserCredentialsForXmpp({
      initBeforeLoadAuth: { myEndpoint: '/users/custom-my' },
    });
    expect(getMyUser).toHaveBeenCalledWith({
      token: 'access',
      endpoint: '/users/custom-my',
    });
  });
});

// ---- rotation durability -------------------------------------------

describe('bootstrap rotation is never dropped', () => {
  it('persists the rotated refreshToken even when /users/my fails afterwards', async () => {
    // The regression this guards: the bootstrap path used to hold the
    // rotated token in a local variable and only write it on the happy
    // path, so a /users/my failure right after the refresh silently
    // discarded it. The next launch would then present an already-burned
    // token — which the backend reads as reuse.
    // No xmpp creds, so the bootstrap actually goes through the
    // /users/my + refresh chain instead of short-circuiting.
    const candidate = userWithXmppCreds({
      token: 'stale-access',
      refreshToken: 'refresh-1',
      xmppPassword: '',
    });

    getMyUser
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockRejectedValueOnce({ response: { status: 401 } });
    http.post.mockResolvedValueOnce({
      data: { token: 'access-2', refreshToken: 'refresh-2' },
    });

    await resolveInitBeforeLoadUser({
      config: { userLogin: { enabled: true, user: candidate } as any },
    });

    expect(http.post).toHaveBeenCalledWith(
      '/v1/users/login/refresh',
      {},
      { headers: { Authorization: 'refresh-1' } }
    );
    expect(store.getState().chatSettingStore.user.refreshToken).toBe(
      'refresh-2'
    );
    const raw = await AsyncStorage.getItem(localStorageConstants.ETHORA_USER);
    expect(JSON.parse(raw as string).refreshToken).toBe('refresh-2');
  });
});

/**
 * Priority-1 stale-snapshot adoption.
 *
 * A `userLogin.user` is usually a snapshot the host captured at its own
 * login time and re-presents on every mount, while the SDK keeps rotating
 * the session and persisting the newest pair (incl. fileToken) into
 * ETHORA_USER. The resolver must prefer whichever refresh pair was minted
 * later (JWT `iat` decides) and backfill a missing fileToken — otherwise
 * secure media (`?ft=`-gated) renders blank on every mount after the
 * first rotation, and dies for good when the snapshot's refresh ages out.
 */
describe('resolveInitBeforeLoadUser — persisted-session adoption (priority 1)', () => {
  const fakeJwt = (iat: number) =>
    `h.${Buffer.from(JSON.stringify({ iat })).toString('base64url')}.s`;

  const persist = (user: any) =>
    AsyncStorage.setItem(
      localStorageConstants.ETHORA_USER,
      JSON.stringify(user)
    );

  it('adopts the persisted pair + fileToken when it is newer than the snapshot', async () => {
    const snapshot = userWithXmppCreds({
      token: 'old-access',
      refreshToken: fakeJwt(1_000),
    });
    await persist({
      _id: 'u',
      token: 'rotated-access',
      refreshToken: fakeJwt(2_000),
      fileToken: 'ft-rotated',
    });

    const out = await resolveInitBeforeLoadUser({
      config: { userLogin: { enabled: true, user: snapshot } as any },
    });

    expect(out?.refreshToken).toBe(fakeJwt(2_000));
    expect(out?.token).toBe('rotated-access');
    expect(out?.fileToken).toBe('ft-rotated');
    // Identity fields still come from the snapshot.
    expect(out?.xmppPassword).toBe('pw');
  });

  it('keeps the snapshot pair when the host re-logged-in (newer iat) but still backfills fileToken', async () => {
    const snapshot = userWithXmppCreds({
      token: 'fresh-access',
      refreshToken: fakeJwt(3_000),
    });
    await persist({
      _id: 'u',
      token: 'older-access',
      refreshToken: fakeJwt(2_000),
      fileToken: 'ft-old',
    });

    const out = await resolveInitBeforeLoadUser({
      config: { userLogin: { enabled: true, user: snapshot } as any },
    });

    expect(out?.refreshToken).toBe(fakeJwt(3_000));
    expect(out?.token).toBe('fresh-access');
    // Better a possibly-stale fileToken (worst case: one 401 → recovery
    // rotation) than guaranteed-blank media until the next rotation.
    expect(out?.fileToken).toBe('ft-old');
  });

  it('ignores a persisted session that belongs to a different account', async () => {
    const snapshot = userWithXmppCreds({
      token: 'snap-access',
      refreshToken: fakeJwt(1_000),
    });
    await persist({
      _id: 'someone-else',
      xmppUsername: 'other',
      token: 'their-access',
      refreshToken: fakeJwt(9_000),
      fileToken: 'their-ft',
    });

    const out = await resolveInitBeforeLoadUser({
      config: { userLogin: { enabled: true, user: snapshot } as any },
    });

    expect(out?.token).toBe('snap-access');
    expect(out?.refreshToken).toBe(fakeJwt(1_000));
    expect(out?.fileToken).toBeUndefined();
  });

  it('returns the snapshot untouched when nothing is persisted', async () => {
    const snapshot = userWithXmppCreds({
      token: 't',
      refreshToken: 'not-a-jwt',
      fileToken: 'ft-snap',
    });

    const out = await resolveInitBeforeLoadUser({
      config: { userLogin: { enabled: true, user: snapshot } as any },
    });

    expect(out?.token).toBe('t');
    expect(out?.fileToken).toBe('ft-snap');
  });
});
