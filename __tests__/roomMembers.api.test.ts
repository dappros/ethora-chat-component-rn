
const mockHttpGet = jest.fn();
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockHttpGet(...args) },
}));

const mockGetState = jest.fn(() => ({
  chatSettingStore: { user: { appId: 'app1' } },
}));
jest.mock('../src/roomStore', () => ({
  store: { getState: () => mockGetState() },
}));

import {
  getUserByXmppUsername,
  resetUserLookupRoute,
  setUserLookupRoute,
} from '../src/networking/api-requests/roomMembers.api';

// Regression for the bug where user X permanently saw a brand-new user Y's
// raw xmpp id as their display name for the rest of the session: this
// module used to cache ANY lookup failure (404, 400, network) as a
// permanent `null`, and a just-registered account's profile can
// legitimately fail to resolve for a little while (backend indexing lag)
// before it starts succeeding. A `null` cached forever meant every later
// message from that same sender kept hitting the cached miss instead of
// retrying - only a full page reload (fresh module state) ever cleared it.
// A miss is now held for MISS_TTL_MS only: long enough to keep a busy room
// from re-requesting an unknown sender on every stanza, short enough that
// the name heals on its own.
describe('getUserByXmppUsername', () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
    resetUserLookupRoute();
    setUserLookupRoute('v2');
    mockGetState.mockReset();
    mockGetState.mockReturnValue({ chatSettingStore: { appId: 'app1' } });
    jest.useFakeTimers();
  });

  afterEach(() => {
    setUserLookupRoute(null);
    jest.useRealTimers();
  });

  it('a failed lookup does not poison the cache - a later call for the same user retries', async () => {
    mockHttpGet.mockRejectedValueOnce({
      response: { status: 400 },
      message: 'Request failed with status code 400',
    });

    const first = await getUserByXmppUsername('app1_newuser', 'token');
    expect(first).toBeNull();

    // Past the short miss TTL: the next message from this sender tries again.
    jest.advanceTimersByTime(6000);

    mockHttpGet.mockResolvedValueOnce({
      data: { result: { xmppUsername: 'app1_newuser', firstName: 'New', lastName: 'User' } },
    });

    const second = await getUserByXmppUsername('app1_newuser', 'token');
    expect(second).toEqual({
      xmppUsername: 'app1_newuser',
      firstName: 'New',
      lastName: 'User',
    });
    expect(mockHttpGet).toHaveBeenCalledTimes(2);
  });

  // The flip side of retrying: a room where an unknown sender is chatty
  // must not turn every incoming stanza into its own failing request.
  it('does not re-request within the miss TTL', async () => {
    mockHttpGet.mockRejectedValue({ response: { status: 400 } });

    await getUserByXmppUsername('app1_chatty', 'token');
    await getUserByXmppUsername('app1_chatty', 'token');
    await getUserByXmppUsername('app1_chatty', 'token');

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  // Some backends answer a not-yet-indexed profile with 200 and an empty
  // body instead of an error. That is a miss too, not a settled answer.
  it('an empty 200 is retried like any other miss', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: {} });
    expect(await getUserByXmppUsername('app1_empty', 'token')).toBeNull();

    jest.advanceTimersByTime(6000);

    mockHttpGet.mockResolvedValueOnce({
      data: { result: { xmppUsername: 'app1_empty', firstName: 'Late', lastName: 'Profile' } },
    });
    expect(await getUserByXmppUsername('app1_empty', 'token')).toEqual({
      xmppUsername: 'app1_empty',
      firstName: 'Late',
      lastName: 'Profile',
    });
    expect(mockHttpGet).toHaveBeenCalledTimes(2);
  });

  it('a successful lookup is still cached (no repeat request for the same user)', async () => {
    mockHttpGet.mockResolvedValue({
      data: { result: { xmppUsername: 'app1_alice', firstName: 'Alice', lastName: 'Doe' } },
    });

    await getUserByXmppUsername('app1_alice', 'token');
    await getUserByXmppUsername('app1_alice', 'token');

    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it('concurrent lookups for the same user in flight share one request', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mockHttpGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const first = getUserByXmppUsername('app1_bob', 'token');
    const second = getUserByXmppUsername('app1_bob', 'token');

    resolveRequest({
      data: { result: { xmppUsername: 'app1_bob', firstName: 'Bob', lastName: 'Ross' } },
    });

    expect(await first).toEqual(await second);
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it('returns null without a network call for an empty/undefined username', async () => {
    expect(await getUserByXmppUsername('', 'token')).toBeNull();
    expect(await getUserByXmppUsername(undefined, 'token')).toBeNull();
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('auto route: v1 first, v2 fallback on 400 remembered, email/tags dropped', async () => {
    setUserLookupRoute(null);
    mockHttpGet.mockImplementation((url: string) =>
      url.startsWith('/v1/')
        ? Promise.reject({ response: { status: 400 } })
        : Promise.resolve({
            data: {
              result: {
                xmppUsername: 'app1_a',
                firstName: 'A',
                lastName: 'B',
                email: 'a@x.test',
                tags: ['t'],
              },
            },
          })
    );
    const first = await getUserByXmppUsername('app1_a', 'token');
    expect(first).toEqual({ xmppUsername: 'app1_a', firstName: 'A', lastName: 'B' });
    await getUserByXmppUsername('app1_c', 'token');
    const urls = mockHttpGet.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u.startsWith('/v1/')).length).toBe(1);
    expect(urls.filter((u) => u === '/v2/chats/users').length).toBe(2);
  });
});
