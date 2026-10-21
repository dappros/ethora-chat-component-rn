/**
 * Scheduled-call REST wrappers: URLs, bodies, the user token, and how the
 * server's refusals are named.
 */

jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('../src/roomStore', () => ({
  store: {
    getState: () => ({ chatSettingStore: { user: { token: 'JWT abc' } } }),
  },
}));

import http from '../src/networking/apiClient';
import {
  cancelScheduledCall,
  createScheduledCall,
  getScheduledCall,
  isScheduledCallApiError,
  listScheduledCalls,
  updateScheduledCall,
} from '../src/networking/api-requests/scheduledCalls.api';

const mocked = http as unknown as Record<'get' | 'post' | 'patch' | 'delete', jest.Mock>;
const call = {
  slug: 'Zq8x_LmN3pRtV-w2YkA9bc',
  chatName: 'app_room',
  title: 'Sync',
  startAt: '2026-11-03T14:30:00.000Z',
  durationMinutes: 30,
  kind: 'video',
  status: 'scheduled',
};
const links = { join: 'https://app.chat.ethora.com/call/x' };
const auth = expect.objectContaining({
  headers: { Authorization: 'JWT abc' },
});

beforeEach(() => Object.values(mocked).forEach((fn) => fn.mockReset()));

it('creates a call', async () => {
  mocked.post.mockResolvedValue({ data: { scheduledCall: call, links } });
  const input = { chatName: 'app_room', startAt: call.startAt, title: 'Sync' };
  const out = await createScheduledCall(input);
  expect(mocked.post).toHaveBeenCalledWith('/v1/chats/calls/scheduled', input, auth);
  expect(out).toEqual({ scheduledCall: call, links });
});

it('lists calls with the filters as query params', async () => {
  mocked.get.mockResolvedValue({
    data: { items: [{ scheduledCall: call, links }] },
  });
  const out = await listScheduledCalls({ chatName: 'app_room', from: 'a', to: 'b' });
  expect(mocked.get).toHaveBeenCalledWith(
    '/v1/chats/calls/scheduled',
    expect.objectContaining({ params: { chatName: 'app_room', from: 'a', to: 'b' } })
  );
  expect(out).toHaveLength(1);
});

it('reads one call by slug, with its chat', async () => {
  const chat = { name: 'app_room', jid: 'app_room@conference.x' };
  mocked.get.mockResolvedValue({ data: { scheduledCall: call, links, chat } });
  const out = await getScheduledCall('a/b');
  expect(mocked.get).toHaveBeenCalledWith('/v1/chats/calls/scheduled/a%2Fb', auth);
  expect(out.chat).toEqual(chat);
});

it('updates and cancels', async () => {
  mocked.patch.mockResolvedValue({ data: { scheduledCall: call, links } });
  await updateScheduledCall('s', { title: 'New' });
  expect(mocked.patch).toHaveBeenCalledWith('/v1/chats/calls/scheduled/s', { title: 'New' }, auth);

  mocked.delete.mockResolvedValue({
    data: { scheduledCall: { ...call, status: 'cancelled' } },
  });
  const cancelled = await cancelScheduledCall('s');
  expect(mocked.delete).toHaveBeenCalledWith('/v1/chats/calls/scheduled/s', auth);
  expect(cancelled.status).toBe('cancelled');
});

describe('errors', () => {
  const fail = async (response: any) => {
    mocked.get.mockRejectedValue(response ? { response } : new Error('offline'));
    try {
      await getScheduledCall('s');
    } catch (error) {
      return error;
    }
    throw new Error('did not throw');
  };

  it('names the refusals', async () => {
    expect(await fail({ status: 404, data: {} })).toMatchObject({ code: 'not-found', status: 404 });
    expect(await fail({ status: 403, data: { error: 'not-a-member' } })).toMatchObject({
      code: 'not-a-member',
    });
    expect(await fail({ status: 403, data: {} })).toMatchObject({ code: 'forbidden' });
    expect(await fail({ status: 400, data: {} })).toMatchObject({ code: 'invalid' });
    expect(await fail({ status: 500, data: {} })).toMatchObject({ code: 'unknown' });
    expect(await fail({ status: 409, data: { code: 'CALL_CANCELLED' } })).toMatchObject({
      code: 'conflict',
      serverCode: 'CALL_CANCELLED',
    });
    expect(await fail({ status: 422, data: { code: 'START_IN_PAST' } })).toMatchObject({
      code: 'invalid',
      serverCode: 'START_IN_PAST',
    });
  });

  it('a request that never reached the server is a network error', async () => {
    const error = await fail(null);
    expect(isScheduledCallApiError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'network' });
  });

  it('a body without the call is an error, not an undefined', async () => {
    mocked.get.mockResolvedValue({ data: {} });
    await expect(getScheduledCall('s')).rejects.toMatchObject({ code: 'unknown' });
  });
});
