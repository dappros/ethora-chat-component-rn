/**
 * secureFileUrl — the fileToken plumbing ported from the web component.
 *
 * Files uploaded through /v2/files/secure are served membership-gated
 * from `secure-files.*` and need the viewer's personal `?ft=` token,
 * appended at render time. The web build builds that URL with the `URL`
 * API; RN's URL is a regex-based polyfill, so this one does string
 * surgery instead — same observable contract, which is what these cases
 * pin down.
 */

jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const store = configureStore({
    reducer: { chatSettingStore: chatSettingsReducer },
  });
  return { __esModule: true, store };
});

jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
  getCurrentBaseURL: () => 'https://api.example.com',
  setBaseURL: jest.fn(),
}));

jest.mock('../src/networking/authRefresh', () => ({
  __esModule: true,
  refreshAuthTokens: jest.fn(),
}));

import { store } from '../src/roomStore';
import { setUser, setConfig } from '../src/roomStore/chatSettingsSlice';
import { refreshAuthTokens } from '../src/networking/authRefresh';
import {
  appendFileToken,
  resolveFileUrl,
  isSecureFileUrl,
  withFileToken,
  requestFileTokenRecovery,
  __resetFileTokenRecoveryForTests,
} from '../src/helpers/secureFileUrl';

const SECURE = 'https://secure-files.chat.example.com/f/abc.jpg';
const PUBLIC = 'https://api.chat.example.com/v1/files/abc.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  __resetFileTokenRecoveryForTests();
  store.dispatch({ type: 'chat/logout' });
});

describe('isSecureFileUrl', () => {
  it.each([
    [SECURE, true],
    ['http://secure-files.example.com/x.png', true],
    ['https://SECURE-FILES.example.com/x.png', true],
    [PUBLIC, false],
    ['https://not-secure-files.example.com/x.png', false],
    ['', false],
    [null, false],
    ['garbage', false],
    // What the v2 endpoint actually returns, relative and resolved.
    ['/secure-media/abc.pdf', true],
    ['https://api.example.com/secure-media/abc.pdf', true],
  ])('%s -> %s', (url, expected) => {
    expect(isSecureFileUrl(url as string)).toBe(expected);
  });
});

describe('resolveFileUrl', () => {
  // `/v2/files/secure` answers with a root-relative location. Left as
  // is, RN reads it as a local filesystem path: a blank image bubble,
  // and `FileNotReadableException` from FileSystem.downloadAsync.
  it('resolves a root-relative location against the API root', () => {
    expect(resolveFileUrl('/secure-media/abc.pdf')).toBe(
      'https://api.example.com/secure-media/abc.pdf'
    );
  });

  it('leaves absolute URLs and non-http schemes alone', () => {
    expect(resolveFileUrl(SECURE)).toBe(SECURE);
    expect(resolveFileUrl(PUBLIC)).toBe(PUBLIC);
    expect(resolveFileUrl('file:///tmp/x.jpg')).toBe('file:///tmp/x.jpg');
    expect(resolveFileUrl('data:image/png;base64,AAA')).toBe(
      'data:image/png;base64,AAA'
    );
  });

  it('returns an empty string for a missing location', () => {
    expect(resolveFileUrl(undefined)).toBe('');
    expect(resolveFileUrl(null)).toBe('');
  });
});

describe('appendFileToken', () => {
  it('appends the token to a secure URL', () => {
    expect(appendFileToken(SECURE, 'tok')).toBe(`${SECURE}?ft=tok`);
  });

  it('leaves public URLs untouched — they are not gated', () => {
    expect(appendFileToken(PUBLIC, 'tok')).toBe(PUBLIC);
  });

  it('returns the URL unchanged when there is no token yet', () => {
    expect(appendFileToken(SECURE, '')).toBe(SECURE);
    expect(appendFileToken(SECURE, null)).toBe(SECURE);
  });

  it('returns an empty string for a missing URL', () => {
    expect(appendFileToken(undefined, 'tok')).toBe('');
    expect(appendFileToken(null, 'tok')).toBe('');
  });

  it('keeps existing query params', () => {
    expect(appendFileToken(`${SECURE}?w=200`, 'tok')).toBe(
      `${SECURE}?w=200&ft=tok`
    );
  });

  it('REPLACES a stale token rather than appending a second one', () => {
    // The failure this guards: two `ft` params, the stale one winning
    // server-side, and the download still 403-ing.
    expect(appendFileToken(`${SECURE}?ft=old`, 'new')).toBe(
      `${SECURE}?ft=new`
    );
    expect(appendFileToken(`${SECURE}?w=200&ft=old&h=100`, 'new')).toBe(
      `${SECURE}?w=200&h=100&ft=new`
    );
  });

  it('resolves AND tokenises a relative /secure-media path', () => {
    expect(appendFileToken('/secure-media/abc.pdf', 'tok')).toBe(
      'https://api.example.com/secure-media/abc.pdf?ft=tok'
    );
  });

  it('keeps the fragment after the query', () => {
    expect(appendFileToken(`${SECURE}#page=2`, 'tok')).toBe(
      `${SECURE}?ft=tok#page=2`
    );
  });

  it('url-encodes the token', () => {
    expect(appendFileToken(SECURE, 'a b&c')).toBe(`${SECURE}?ft=a%20b%26c`);
  });
});

describe('withFileToken', () => {
  it('reads the current token straight from the store', () => {
    store.dispatch(setUser({ fileToken: 'from-store' } as any));
    expect(withFileToken(SECURE)).toBe(`${SECURE}?ft=from-store`);
  });

  it('is a no-op without a token', () => {
    expect(withFileToken(SECURE)).toBe(SECURE);
  });
});

describe('requestFileTokenRecovery', () => {
  const enableRefresh = () => {
    store.dispatch(setConfig({ refreshTokens: { enabled: true } } as any));
    store.dispatch(setUser({ refreshToken: 'r' } as any));
  };

  it('does nothing when refresh is not configured', async () => {
    await expect(requestFileTokenRecovery()).resolves.toBe(false);
    expect(refreshAuthTokens).not.toHaveBeenCalled();
  });

  it('rotates and reports whether a fileToken came back', async () => {
    enableRefresh();
    (refreshAuthTokens as jest.Mock).mockResolvedValueOnce({
      token: 't',
      refreshToken: 'r2',
      fileToken: 'ft-new',
    });

    await expect(requestFileTokenRecovery()).resolves.toBe(true);
    expect(refreshAuthTokens).toHaveBeenCalledTimes(1);
  });

  it('throttles a screenful of broken images into ONE refresh', async () => {
    enableRefresh();
    (refreshAuthTokens as jest.Mock).mockResolvedValue({
      token: 't',
      refreshToken: 'r2',
      fileToken: 'ft-new',
    });

    await Promise.all([
      requestFileTokenRecovery(),
      requestFileTokenRecovery(),
      requestFileTokenRecovery(),
    ]);
    // ...and a later one within the cooldown is refused too.
    await requestFileTokenRecovery();

    expect(refreshAuthTokens).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the rotation fails', async () => {
    enableRefresh();
    (refreshAuthTokens as jest.Mock).mockRejectedValueOnce(
      new Error('network')
    );

    await expect(requestFileTokenRecovery()).resolves.toBe(false);
  });
});
