/** clientRegistry — singleton, reuse-by-key, init-lock dedup. */

import {
  buildXmppClientKey,
  getReusableXmppClientByKey,
  isXmppClientReusable,
  setGlobalXmppClient,
  withXmppClientInitLock,
} from '../src/utils/clientRegistry';

const fakeClient = (status: string) =>
  ({ status } as any /* satisfies XmppClient */);

afterEach(() => {
  // Reset module-level singleton state between tests.
  setGlobalXmppClient(null);
});

describe('buildXmppClientKey', () => {
  it('is deterministic for same user + settings', () => {
    const a = buildXmppClientKey('alice', {
      devServer: 'xmpp.host',
      host: 'host',
      conference: 'conf.host',
    });
    const b = buildXmppClientKey('alice', {
      devServer: 'xmpp.host',
      host: 'host',
      conference: 'conf.host',
    });
    expect(a).toBe(b);
  });

  it('differs across users', () => {
    expect(buildXmppClientKey('alice')).not.toBe(
      buildXmppClientKey('bob')
    );
  });

  it('differs across devServers', () => {
    expect(
      buildXmppClientKey('u', { devServer: 'a' })
    ).not.toBe(buildXmppClientKey('u', { devServer: 'b' }));
  });
});

describe('isXmppClientReusable', () => {
  it('true for online / connecting', () => {
    expect(isXmppClientReusable(fakeClient('online'))).toBe(true);
    expect(isXmppClientReusable(fakeClient('connecting'))).toBe(true);
  });
  it('false for offline / error / null', () => {
    expect(isXmppClientReusable(fakeClient('offline'))).toBe(false);
    expect(isXmppClientReusable(fakeClient('error'))).toBe(false);
    expect(isXmppClientReusable(null)).toBe(false);
  });
});

describe('global client storage + key match', () => {
  it('returns the stored client when key matches and reusable', () => {
    const c = fakeClient('online');
    setGlobalXmppClient(c, 'k1');
    expect(getReusableXmppClientByKey('k1')).toBe(c);
  });

  it('returns null when key does not match', () => {
    setGlobalXmppClient(fakeClient('online'), 'k1');
    expect(getReusableXmppClientByKey('other')).toBeNull();
  });

  it('returns null when the cached client is offline', () => {
    setGlobalXmppClient(fakeClient('offline'), 'k1');
    expect(getReusableXmppClientByKey('k1')).toBeNull();
  });
});

describe('withXmppClientInitLock', () => {
  it('runs the init function once when called concurrently for the same key', async () => {
    const init = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return fakeClient('online');
    });
    const [r1, r2, r3] = await Promise.all([
      withXmppClientInitLock('k1', init),
      withXmppClientInitLock('k1', init),
      withXmppClientInitLock('k1', init),
    ]);
    expect(init).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('re-runs after the previous lock resolves', async () => {
    const init = jest.fn(async () => fakeClient('online'));
    await withXmppClientInitLock('k1', init);
    await withXmppClientInitLock('k1', init);
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('keeps separate locks per key', async () => {
    const init = jest.fn(async () => fakeClient('online'));
    await Promise.all([
      withXmppClientInitLock('k1', init),
      withXmppClientInitLock('k2', init),
    ]);
    expect(init).toHaveBeenCalledTimes(2);
  });
});
