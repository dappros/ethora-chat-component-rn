/**
 * The preload a host's config asks for: staged (default) = a one-message
 * preview pass for rooms without a preview, then a full first page for the
 * top rooms; 'all' = no cap; 'off' = nothing; 'legacy' = the old single pass.
 */
const mockScheduler = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/helpers/historyPreloadScheduler', () => ({
  runHistoryPreloadScheduler: (...a: unknown[]) => mockScheduler(...a),
}));

import { runConfiguredHistoryPreload } from '../src/helpers/runConfiguredHistoryPreload';

const client: any = {};

beforeEach(() => mockScheduler.mockClear());

const optsOf = (n: number) => mockScheduler.mock.calls[n][0];

describe('runConfiguredHistoryPreload', () => {
  it('staged by default: preview pass then full pass for the top 8, 3 at a time', async () => {
    await runConfiguredHistoryPreload({ client, config: {} });
    expect(mockScheduler).toHaveBeenCalledTimes(2);
    expect(optsOf(0)).toMatchObject({
      pageSize: 1,
      skipApiPreview: true,
      completionState: 'partial',
      concurrency: 3,
      roomLimit: 32,
    });
    expect(optsOf(1)).toMatchObject({
      pageSize: 15,
      roomLimit: 8,
      concurrency: 3,
    });
    expect(optsOf(1).skipApiPreview).toBeUndefined();
  });

  it("'off' runs nothing", async () => {
    await runConfiguredHistoryPreload({
      client,
      config: { historyPreload: { mode: 'off' } },
    });
    expect(mockScheduler).not.toHaveBeenCalled();
  });

  it("'all' is one pass without a cap", async () => {
    await runConfiguredHistoryPreload({
      client,
      config: { historyPreload: { mode: 'all', concurrency: 4 } },
    });
    expect(mockScheduler).toHaveBeenCalledTimes(1);
    expect(optsOf(0).roomLimit).toBeUndefined();
    expect(optsOf(0).concurrency).toBe(4);
  });

  it("'legacy' (stagedPreloadEnabled:false) keeps the old single pass over every room", async () => {
    await runConfiguredHistoryPreload({
      client,
      config: { historyQoS: { stagedPreloadEnabled: false } },
    });
    expect(mockScheduler).toHaveBeenCalledTimes(1);
    expect(optsOf(0).roomLimit).toBeUndefined();
    expect(optsOf(0).skipApiPreview).toBeUndefined();
  });

  it('honours the older historyQoS names when historyPreload is not set', async () => {
    await runConfiguredHistoryPreload({
      client,
      config: { historyQoS: { preloadTopKRooms: 5, stagedPreloadConcurrency: 2 } },
    });
    expect(optsOf(1)).toMatchObject({ roomLimit: 5, concurrency: 2 });
  });
});
