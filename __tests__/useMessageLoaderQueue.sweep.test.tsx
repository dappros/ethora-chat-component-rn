/** The loader sweep never overlaps itself and never waits forever on one load. */
import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import useMessageLoaderQueue from '../src/hooks/useMessageLoaderQueue';

const Probe: React.FC<{
  loadMore: (jid: string, max: number) => Promise<unknown>;
}> = ({ loadMore }) => {
  useMessageLoaderQueue(
    ['a@h', 'b@h'],
    {
      'a@h': { jid: 'a@h', messages: [] },
      'b@h': { jid: 'b@h', messages: [] },
    } as any,
    false,
    false,
    loadMore,
    1,
    10,
    100
  );
  return <Text>probe</Text>;
};

describe('useMessageLoaderQueue sweep', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not start a second sweep while one is still waiting on a slow load', async () => {
    const loadMore = jest.fn(() => new Promise(() => {}));
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<Probe loadMore={loadMore} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    // Ten ticks went by; the first load is still pending, so only it ran.
    expect(loadMore).toHaveBeenCalledTimes(1);
    tree!.unmount();
  });

  it('gives up on a load that never answers and moves to the next room', async () => {
    const loadMore = jest.fn(() => new Promise(() => {}));
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<Probe loadMore={loadMore} />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(21_000);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(loadMore).toHaveBeenCalledWith('b@h', 10);
    tree!.unmount();
  });
});
