import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  clearPendingJump,
  requestJumpToMessage,
} from '../src/roomStore/roomsSlice';
import {
  HIGHLIGHT_SETTLE_MS,
  JUMP_PAGE_SIZE,
  MAX_HISTORY_PAGES,
  useJumpToMessage,
} from '../src/hooks/useJumpToMessage';
import {
  findMessageIndex,
  scrollRetryOffset,
  MAX_SCROLL_RETRIES,
} from '../src/helpers/jumpToMessage';
import { toastEmitter } from '../src/utils/toastEmitter';
import { collectMessageIds } from '../src/helpers/openRoomAtMessage';

const ROOM = 'general@conference.x';
const msg = (id: string, body = `body ${id}`, date = '2026-01-01T00:00:00Z') =>
  ({ id, body, date, roomJid: ROOM, user: {} } as any);

describe('findMessageIndex', () => {
  const list = [
    msg('100'),
    { ...msg('101'), xmppId: 'client-1' },
    msg('102', 'same text', '2026-01-01T10:00:00Z'),
  ];

  it('matches by message id, then by xmppId', () => {
    expect(findMessageIndex(list, ['100'])).toBe(0);
    expect(findMessageIndex(list, ['', 'client-1'].filter(Boolean))).toBe(1);
    expect(findMessageIndex(list, ['nope'])).toBe(-1);
  });

  it('falls back to same body within 5 seconds when the hit has no id', () => {
    const content = { body: 'same text', createdAt: '2026-01-01T10:00:04Z' };
    expect(findMessageIndex(list, [], content)).toBe(2);
    expect(
      findMessageIndex(list, [], { ...content, createdAt: '2026-01-01T10:00:06Z' })
    ).toBe(-1);
    expect(
      findMessageIndex(list, [], { ...content, body: 'other text' })
    ).toBe(-1);
  });

  it('never matches an empty-id hit against everything', () => {
    expect(findMessageIndex(list, [])).toBe(-1);
  });
});

describe('scrollRetryOffset', () => {
  it('estimates from the average row height and gives up after the budget', () => {
    expect(scrollRetryOffset({ index: 10, averageItemLength: 80 }, 0)).toBe(800);
    expect(
      scrollRetryOffset({ index: 10, averageItemLength: 80 }, MAX_SCROLL_RETRIES)
    ).toBeNull();
  });
});

describe('collectMessageIds', () => {
  it('drops blanks and duplicates', () => {
    expect(collectMessageIds('a', '', undefined, 'a', 7, null)).toEqual(['a', '7']);
  });
});

describe('pendingJump reducer', () => {
  it('ignores a request that names neither an id nor content', () => {
    store.dispatch(clearPendingJump());
    store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['', ''] }));
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('accepts content-only and id-only requests and clears', () => {
    store.dispatch(
      requestJumpToMessage({ roomJID: ROOM, ids: [], createdAt: 'x', body: 'b' })
    );
    expect(store.getState().rooms.pendingJump?.body).toBe('b');
    store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['1', ''] }));
    expect(store.getState().rooms.pendingJump?.ids).toEqual(['1']);
    store.dispatch(clearPendingJump());
    expect(store.getState().rooms.pendingJump).toBeNull();
  });
});

describe('useJumpToMessage', () => {
  let props: any;
  let tree: renderer.ReactTestRenderer;
  const scrollToIndex = jest.fn();
  const onHighlight = jest.fn();
  const toasts: any[] = [];
  let unsubscribe: () => void;

  const Probe = ({ p }: { p: any }) => {
    useJumpToMessage(p);
    return null;
  };
  const mount = () => {
    act(() => {
      tree = renderer.create(
        <Provider store={store}>
          <Probe p={props} />
        </Provider>
      );
    });
  };
  const update = (next: Partial<typeof props>) => {
    props = { ...props, ...next };
    act(() => {
      tree.update(
        <Provider store={store}>
          <Probe p={props} />
        </Provider>
      );
    });
  };
  const chrono = (ids: string[]) => ids.map((id) => msg(id));
  const setMessages = (ids: string[]) =>
    update({ messages: chrono(ids), listData: chrono(ids).reverse() });
  const flush = async (ms = 0) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    scrollToIndex.mockReset();
    onHighlight.mockReset();
    toasts.length = 0;
    unsubscribe = toastEmitter.subscribe((t) => toasts.push(t));
    store.dispatch(clearPendingJump());
    props = {
      roomJID: ROOM,
      messages: chrono(['1', '2', '3']),
      listData: chrono(['1', '2', '3']).reverse(),
      scrollToIndex,
      onHighlight,
      loadMoreMessages: jest.fn().mockResolvedValue(undefined),
      historyComplete: false,
      isUserAtBottomRef: { current: true },
    };
  });
  afterEach(() => {
    unsubscribe();
    act(() => tree?.unmount());
    jest.useRealTimers();
  });

  it('scrolls to a loaded message, highlights it, and releases the bottom pin', async () => {
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['2'] }));
    });
    await flush(10);
    // listData is newest-first: ['3','2','1'], so message 2 is row 1.
    expect(scrollToIndex).toHaveBeenCalledWith(1);
    // The highlight waits for the scroll to settle.
    expect(onHighlight).not.toHaveBeenCalled();
    expect(props.isUserAtBottomRef.current).toBe(false);
    expect(store.getState().rooms.pendingJump).toBeNull();
    expect(toasts).toHaveLength(0);
    await flush(HIGHLIGHT_SETTLE_MS);
    expect(onHighlight).toHaveBeenCalledWith('2');
    await flush(1100);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('ignores a request for another room', async () => {
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: 'other@x', ids: ['2'] }));
    });
    await flush(10);
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(store.getState().rooms.pendingJump).not.toBeNull();
  });

  it('pages older history by the server cursor until the message turns up', async () => {
    const fetchOlderPage = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, cursor: 0, complete: false })
      // The second page is still in flight when the first one's rows arrive.
      .mockReturnValue(new Promise(() => undefined));
    props = { ...props, fetchOlderPage };
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['0'] }));
    });
    await flush(0);
    // The request asks for the page BEFORE the oldest loaded message.
    expect(fetchOlderPage).toHaveBeenNthCalledWith(1, ROOM, 1, JUMP_PAGE_SIZE);

    setMessages(['0', '1', '2', '3']);
    await flush(10);
    expect(scrollToIndex).toHaveBeenCalledWith(3);
    expect(toasts).toHaveLength(0);
  });

  it('ends in a not-found message when a page makes no progress', async () => {
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['missing'] }));
    });
    // The room reports no cursor and no completion: the page did not move
    // anything, so asking again would repeat it. No timing guess involved.
    await flush(0);
    await flush(0);
    expect(props.loadMoreMessages).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('That message is too far back to load.');
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('says not-found at once when the history is already complete', async () => {
    props = { ...props, historyComplete: true };
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['missing'] }));
    });
    await flush(0);
    expect(props.loadMoreMessages).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('stops after the page budget even if the archive keeps delivering', async () => {
    // Every page moves the server cursor, so only the budget ends the paging.
    const fetchOlderPage = jest.fn(async (_jid: string, before: number) => ({
      ok: true,
      cursor: before - 1,
      complete: false,
    }));
    props = { ...props, fetchOlderPage };
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['never'] }));
    });
    for (let i = 0; i < MAX_HISTORY_PAGES + 3; i++) {
      await flush(0);
    }
    await flush(10);
    expect(fetchOlderPage).toHaveBeenCalledTimes(MAX_HISTORY_PAGES);
    expect(toasts).toHaveLength(1);
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('drops a request nobody fulfilled within the TTL', async () => {
    props = { ...props, messages: [], listData: [] };
    mount();
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['x'] }));
    });
    expect(store.getState().rooms.pendingJump).not.toBeNull();
    jest.setSystemTime(new Date('2026-06-01T00:01:00Z'));
    setMessages(['1']);
    await flush(10);
    expect(toasts).toHaveLength(1);
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('matches an archive row with no id by text and time', async () => {
    mount();
    act(() => {
      store.dispatch(
        requestJumpToMessage({
          roomJID: ROOM,
          ids: [],
          createdAt: '2026-01-01T00:00:02Z',
          body: 'body 1',
        })
      );
    });
    await flush(10);
    expect(scrollToIndex).toHaveBeenCalledWith(2);
  });
});
