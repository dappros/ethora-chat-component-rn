
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../src/roomStore', () => ({
  store: {
    getState: () => ({ chatSettingStore: { user: { token: 'tok' } } }),
  },
}));

import http from '../src/networking/apiClient';
import {
  fetchIceServers,
  reportCallConnected,
  reportCallDeclined,
  reportCallEnded,
  reportCallRinging,
} from '../src/networking/api-requests/callState.api';

const httpMock = http as unknown as { get: jest.Mock; post: jest.Mock };

describe('p2p call state reports', () => {
  beforeEach(() => {
    httpMock.get.mockReset();
    httpMock.post.mockReset();
    httpMock.post.mockResolvedValue({ data: { ok: true } });
  });

  it('posts each report to its endpoint, authenticated, with no body', () => {
    reportCallRinging('c1');
    reportCallDeclined('c1');
    reportCallConnected('c1');
    reportCallEnded('c1');
    const auth = { headers: { Authorization: 'tok' } };
    expect(httpMock.post.mock.calls).toEqual([
      ['/v1/chats/call/state/ringing/c1', undefined, auth],
      ['/v1/chats/call/state/decline/c1', undefined, auth],
      ['/v1/chats/call/state/connected/c1', undefined, auth],
      ['/v1/chats/call/state/end/c1', undefined, auth],
    ]);
  });

  it('does nothing without a callId and never throws or rejects', async () => {
    reportCallEnded(null);
    reportCallEnded('  ');
    expect(httpMock.post).not.toHaveBeenCalled();

    httpMock.post.mockRejectedValue({ response: { status: 409 } });
    expect(() => reportCallEnded('c9')).not.toThrow();
    await Promise.resolve();
  });

  it('encodes the callId in the path', () => {
    reportCallEnded('a/b');
    expect(httpMock.post.mock.calls[0][0]).toBe('/v1/chats/call/state/end/a%2Fb');
  });
});

describe('fetchIceServers', () => {
  beforeEach(() => {
    httpMock.get.mockReset();
  });

  it('returns the normalised list and ttl', async () => {
    httpMock.get.mockResolvedValue({
      data: {
        ok: true,
        enabled: true,
        iceServers: [
          { urls: 'stun:s.example.com' },
          { urls: 'ftp://bad' },
        ],
        ttlSeconds: 86400,
      },
    });
    const result = await fetchIceServers();
    expect(httpMock.get).toHaveBeenCalledWith('/v1/calls/ice-servers', {
      headers: { Authorization: 'tok' },
    });
    expect(result).toEqual({
      enabled: true,
      iceServers: [{ urls: 'stun:s.example.com' }],
      ttlSeconds: 86400,
    });
  });

  it('passes enabled:false with an empty list through', async () => {
    httpMock.get.mockResolvedValue({
      data: { ok: true, enabled: false, iceServers: [], ttlSeconds: 0 },
    });
    expect(await fetchIceServers()).toEqual({
      enabled: false,
      iceServers: [],
      ttlSeconds: null,
    });
  });

  it('returns null on failure', async () => {
    httpMock.get.mockRejectedValue(new Error('down'));
    expect(await fetchIceServers()).toBeNull();
  });
});
