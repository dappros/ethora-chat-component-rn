/**
 * getRoomsWithRetry — REST sync retry loop.
 *
 * The wrapper around the consumer's `syncRoomsFunction` that retries
 * on empty/missing results up to `maxRetries`, with a delay between
 * attempts. Returns null after the cap. Used to wait for the consumer
 * room list to populate after XMPP comes online.
 */

import { getRoomsWithRetry } from '../src/helpers/getRoomsWithRetry';

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(0);
  }
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('getRoomsWithRetry', () => {
  it('returns immediately on success when the result list is non-empty', async () => {
    const rooms = [{ name: 'r1' }];
    const sync = jest.fn().mockResolvedValue(rooms);
    const p = getRoomsWithRetry({} as any, {} as any, sync as any, null, 3, 100);
    await flush();
    await expect(p).resolves.toBe(rooms);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying when the result is empty and stops at maxRetries → null', async () => {
    const sync = jest.fn().mockResolvedValue([]);
    const p = getRoomsWithRetry({} as any, {} as any, sync as any, null, 2, 50);
    // Drive past all the delay()s: 2 retries × 50ms each.
    await flush();
    jest.advanceTimersByTime(50);
    await flush();
    jest.advanceTimersByTime(50);
    await flush();
    jest.advanceTimersByTime(50);
    await flush();
    await expect(p).resolves.toBeNull();
    // maxRetries=2 means up to 3 attempts (the initial + 2 retries).
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it('eats a thrown error and retries', async () => {
    const sync = jest
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce([{ name: 'r1' }]);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const p = getRoomsWithRetry({} as any, {} as any, sync as any, null, 3, 25);
    await flush();
    jest.advanceTimersByTime(25);
    await flush();
    await expect(p).resolves.toEqual([{ name: 'r1' }]);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('with activeChatJid set, only succeeds when that room is present', async () => {
    const sync = jest
      .fn()
      // First try: rooms exist but our target isn't in there → keep retrying
      .mockResolvedValueOnce([{ name: 'other' }])
      // Second try: target appears
      .mockResolvedValueOnce([{ name: 'other' }, { name: 'target' }]);
    const p = getRoomsWithRetry(
      {} as any,
      {} as any,
      sync as any,
      'target@host', // activeChatJid — isChatIdPresentInArray strips the @host
      3,
      25
    );
    await flush();
    jest.advanceTimersByTime(25);
    await flush();
    const result = await p;
    expect(result).toEqual([{ name: 'other' }, { name: 'target' }]);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
