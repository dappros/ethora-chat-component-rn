/**
 * XMPP credential recovery after a SASL not-authorized:
 * rotation first, then POST /v1/users/xmpp-token, then the stored value.
 */
const mockPost = jest.fn();
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { post: (...a: any[]) => mockPost(...a), get: jest.fn() },
}));
const mockSet = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/helpers/secureUserStorage', () => ({
  secureUserStorage: () => ({ set: mockSet, get: jest.fn(), remove: jest.fn() }),
}));
const mockRotate = jest.fn();
jest.mock('../src/networking/authRefresh', () => ({
  refreshAuthTokensQuietly: (...a: any[]) => mockRotate(...a),
}));
const mockChain = jest.fn();
jest.mock('../src/helpers/resolveInitBeforeLoadUser', () => ({
  applyResolvedUserToStore: jest.fn(),
  refreshUserCredentialsForXmpp: (...a: any[]) => mockChain(...a),
}));
jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const store = configureStore({
    reducer: {
      chatSettingStore: require('../src/roomStore/chatSettingsSlice').default,
    },
  });
  return { __esModule: true, store };
});

import { store } from '../src/roomStore';
import { setUser } from '../src/roomStore/chatSettingsSlice';
import { fetchFreshXmppPassword } from '../src/networking/api-requests/xmppToken.api';
import { recoverXmppCredentials } from '../src/networking/xmppCredentials';

const seed = (over: any = {}) =>
  store.dispatch(
    setUser({
      token: 'tok',
      xmppPassword: 'old',
      xmppUsername: 'u1',
      ...over,
    } as any)
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRotate.mockResolvedValue(null);
  mockChain.mockResolvedValue(null);
  seed();
  mockSet.mockClear(); // setUser persists too
});

describe('fetchFreshXmppPassword', () => {
  it('posts with the raw token (no Bearer), stores and persists the password', async () => {
    mockPost.mockResolvedValue({ data: { success: true, xmppPassword: 'new' } });
    await expect(fetchFreshXmppPassword()).resolves.toBe('new');
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/users/xmpp-token',
      {},
      { headers: { Authorization: 'tok' } }
    );
    expect((store.getState() as any).chatSettingStore.user.xmppPassword).toBe('new');
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers and clears afterwards', async () => {
    let resolve: any;
    mockPost.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = fetchFreshXmppPassword();
    const b = fetchFreshXmppPassword();
    resolve({ data: { xmppPassword: 'x' } });
    await Promise.all([a, b]);
    expect(mockPost).toHaveBeenCalledTimes(1);
    mockPost.mockResolvedValue({ data: { xmppPassword: 'y' } });
    await expect(fetchFreshXmppPassword()).resolves.toBe('y');
  });

  it('never throws and returns null on failure or missing token', async () => {
    mockPost.mockRejectedValue(new Error('500'));
    await expect(fetchFreshXmppPassword()).resolves.toBeNull();
    seed({ token: '' });
    mockPost.mockClear();
    await expect(fetchFreshXmppPassword()).resolves.toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
    // a later call after login is not served a stale null
    seed();
    mockPost.mockResolvedValue({ data: { xmppPassword: 'z' } });
    await expect(fetchFreshXmppPassword()).resolves.toBe('z');
  });

  it('keeps the credential when persisting fails', async () => {
    mockSet.mockRejectedValueOnce(new Error('disk'));
    mockPost.mockResolvedValue({ data: { xmppPassword: 'kept' } });
    await expect(fetchFreshXmppPassword()).resolves.toBe('kept');
  });
});

describe('recoverXmppCredentials order', () => {
  it('uses session rotation first and skips the endpoint', async () => {
    mockRotate.mockResolvedValue({ xmppPassword: 'rot' });
    const r = await recoverXmppCredentials({ refreshTokens: { enabled: true } } as any);
    expect(r).toEqual({ username: 'u1', password: 'rot' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not rotate when the host did not enable it, and asks the endpoint', async () => {
    mockPost.mockResolvedValue({ data: { xmppPassword: 'fresh' } });
    const r = await recoverXmppCredentials({} as any);
    expect(mockRotate).not.toHaveBeenCalled();
    expect(r).toEqual({ username: 'u1', password: 'fresh' });
  });

  it('falls to the endpoint when rotation yields no xmppPassword', async () => {
    mockRotate.mockResolvedValue({ token: 't' });
    mockPost.mockResolvedValue({ data: { xmppPassword: 'fresh' } });
    const r = await recoverXmppCredentials({ refreshTokens: { enabled: true } } as any);
    expect(r.password).toBe('fresh');
  });

  it('falls back to the stored value when everything fails', async () => {
    mockPost.mockRejectedValue(new Error('down'));
    mockChain.mockRejectedValue(new Error('down'));
    const r = await recoverXmppCredentials({} as any);
    expect(r).toEqual({ username: 'u1', password: 'old' });
  });
});
