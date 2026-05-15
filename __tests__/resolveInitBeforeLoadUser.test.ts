/** resolveInitBeforeLoadUser — priority chain. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveInitBeforeLoadUser } from '../src/helpers/resolveInitBeforeLoadUser';
import { localStorageConstants } from '../src/helpers/constants/LOCAL_STORAGE';
import { store } from '../src/roomStore';
import { logout } from '../src/roomStore/chatSettingsSlice';

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
