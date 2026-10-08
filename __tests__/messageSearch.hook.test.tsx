import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockSearch = jest.fn();
jest.mock('../src/networking/api-requests/messageSearch.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/messageSearch.api'),
  MESSAGE_SEARCH_PAGE_SIZE: 20,
  searchMessages: (...a: unknown[]) => mockSearch(...a),
}));

import { useMessageSearch } from '../src/components/Modals/MessageSearchModal/useMessageSearch';

// No @testing-library in this repo: a probe component that exposes the hook.
function renderHook<P, R>(hook: (p: P) => R, initialProps: P) {
  const result: { current: R } = { current: undefined as unknown as R };
  const Probe = ({ props }: { props: P }) => {
    result.current = hook(props);
    return null;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Probe props={initialProps} />);
  });
  return {
    result,
    rerender: (props: P) =>
      act(() => {
        tree.update(<Probe props={props} />);
      }),
  };
}

const hit = (id: string) => ({
  id,
  chatId: 'r',
  chatType: 'groupchat',
  room: 'r@c',
  from: 'u',
  fromUserId: 'u',
  body: 'b',
  messageId: id,
  stanzaId: id,
  createdAt: '2026-01-01T00:00:00Z',
});
const page = (ids: string[], total: number, nextOffset: number) => ({
  items: ids.map(hit),
  total,
  offset: 0,
  limit: 20,
  nextOffset,
});

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

describe('useMessageSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSearch.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('waits for two characters and debounces typing into one request', async () => {
    mockSearch.mockResolvedValue(page(['1'], 1, 1));
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useMessageSearch(q, 'chat', 'r'),
      { q: 'h' }
    );
    expect(result.current.searchable).toBe(false);

    rerender({ q: 'he' });
    rerender({ q: 'hel' });
    await advance(400);

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0]).toMatchObject({
      q: 'hel',
      chatId: 'r',
      offset: 0,
    });
    expect(result.current.items).toHaveLength(1);
  });

  it('aborts the request in flight when the query changes', async () => {
    const signals: AbortSignal[] = [];
    mockSearch.mockImplementation(({ signal }: any) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });
    const { rerender } = renderHook(
      ({ q }: { q: string }) => useMessageSearch(q, 'all'),
      { q: 'he' }
    );
    await advance(400);
    rerender({ q: 'hello' });
    expect(signals[0].aborted).toBe(true);
  });

  it('drops a slow answer that was superseded by a newer query', async () => {
    let resolveOld!: (v: unknown) => void;
    mockSearch
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(page(['new'], 1, 1));

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useMessageSearch(q, 'all'),
      { q: 'he' }
    );
    await advance(400);
    rerender({ q: 'hello' });
    await advance(400);
    await act(async () => {
      resolveOld(page(['old'], 1, 1));
    });

    expect(result.current.items.map((h) => h.stanzaId)).toEqual(['new']);
  });

  it('pages by server rows and never repeats a hit', async () => {
    mockSearch
      .mockResolvedValueOnce(page(['1', '2'], 5, 3)) // one row was hidden server-side
      .mockResolvedValueOnce(page(['2', '4'], 5, 5)); // overlap: '2' again

    const { result } = renderHook(
      () => useMessageSearch('hello', 'all'),
      undefined
    );
    await advance(400);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMore();
    });

    expect(mockSearch.mock.calls[1][0]).toMatchObject({ offset: 3 });
    expect(result.current.items.map((h) => h.stanzaId)).toEqual(['1', '2', '4']);
    expect(result.current.hasMore).toBe(false);
  });

  it('reports a failed request so the panel can offer a retry', async () => {
    mockSearch.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => useMessageSearch('hello', 'all'),
      undefined
    );
    await advance(400);
    expect(result.current.status).toBe('error');
  });

  it('does not search a single-chat scope without a room', async () => {
    const { result } = renderHook(
      () => useMessageSearch('hello', 'chat', undefined),
      undefined
    );
    await advance(400);
    expect(result.current.searchable).toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
