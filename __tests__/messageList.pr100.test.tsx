import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

const mockScrollToOffset = jest.fn();
const mockScrollToIndex = jest.fn();

jest.mock('react-native', () => {
  const ReactNative = require('react');

  const FlatList = ReactNative.forwardRef((props: any, ref: any) => {
    ReactNative.useImperativeHandle(ref, () => ({
      scrollToOffset: mockScrollToOffset,
      scrollToIndex: mockScrollToIndex,
    }));
    return ReactNative.createElement(
      'View',
      {
        testID: 'mock-flat-list',
        data: props.data,
        onScroll: props.onScroll,
        onContentSizeChange: props.onContentSizeChange,
        onLayout: props.onLayout,
        onEndReached: props.onEndReached,
        onStartReached: props.onStartReached,
        onEndReachedThreshold: props.onEndReachedThreshold,
        maintainVisibleContentPosition: props.maintainVisibleContentPosition,
        inverted: props.inverted,
      },
      (props.data || []).map((item: any, index: number) =>
        ReactNative.createElement(
          ReactNative.Fragment,
          { key: props.keyExtractor ? props.keyExtractor(item, index) : String(index) },
          props.renderItem({ item, index })
        )
      ),
      props.ListFooterComponent || null
    );
  });

  return {
    View: ({ children, ...props }: any) =>
      ReactNative.createElement('View', props, children),
    Text: ({ children, ...props }: any) =>
      ReactNative.createElement('Text', props, children),
    Image: (props: any) => ReactNative.createElement('Image', props),
    TouchableOpacity: ({ children, ...props }: any) =>
      ReactNative.createElement('TouchableOpacity', props, children),
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
    Platform: {
      OS: 'ios',
      Version: 17,
      isPad: false,
      isTV: false,
      select: (spec: any) =>
        'ios' in spec ? spec.ios : spec.native ?? spec.default,
    },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    Keyboard: {
      addListener: () => ({ remove: () => {} }),
      removeAllListeners: () => {},
      dismiss: () => {},
    },
    FlatList,
  };
});

jest.mock('../src/components/MainComponents/MessageContainer', () => {
  const ReactNative = require('react');
  const { Text } = require('react-native');
  return {
    MessageContainer: ({ message }: any) =>
      ReactNative.createElement(Text, {}, message?.body || ''),
  };
});
jest.mock('../src/components/styled/StyledInputComponents/Composing', () => () => null);
jest.mock('../src/components/styled/StyledInputComponents/CustomTypingIndicator', () => () => null);
jest.mock('../src/components/styled/Loader', () => {
  const ReactNative = require('react');
  return () => ReactNative.createElement('View', { testID: 'loader' });
});
jest.mock('../src/components/styled/TreadLabel', () => () => null);
jest.mock('../src/assets/icons', () => ({ ArowDownIcon: () => null }));

import roomsReducer, {
  addRoom,
  addRoomMessage,
  requestJumpToMessage,
  setCurrentRoom,
  setJumpWindow,
  updateRoom,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import MessageList, {
  HISTORY_PAGE_SIZE,
  MAX_IDLE_AUTO_PAGES,
  WINDOW_EXIT_GRACE_MS,
  WINDOW_SETTLE_MS,
} from '../src/components/MainComponents/MessageList';
import { clearJumpThread, setJumpThread } from '../src/helpers/jumpThread';

const ROOM = 'room1@conference.example.com';
const SELF = 'self-user';
const PEER = 'peer-user';

const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
type Store = ReturnType<typeof makeStore>;

const msg = (id: number, userId = PEER) =>
  ({
    id: String(id),
    body: `m${id}`,
    date: new Date(id).toISOString(),
    roomJid: ROOM,
    showInChannel: 'true',
    user: { id: userId, name: 'Someone', token: '', refreshToken: '' },
  }) as any;

const seed = (store: Store, over: Record<string, unknown> = {}, messages = [msg(1_000_000)]) => {
  store.dispatch(
    addRoom({
      roomData: {
        id: ROOM,
        name: 'Room',
        jid: ROOM,
        title: 'Room',
        usersCnt: 2,
        messages,
        isLoading: false,
        roomBg: '',
        composing: false,
        composingList: [],
        historyComplete: false,
        messageStats: { firstMessageTimestamp: 900_000 },
        ...over,
      } as any,
    })
  );
  store.dispatch(setCurrentRoom({ roomJID: ROOM }));
};

const setup = async (
  store: Store,
  opts: { loadMore?: jest.Mock; client?: any; onReadBoundaryChange?: jest.Mock } = {}
) => {
  const loadMore = opts.loadMore ?? jest.fn().mockResolvedValue(undefined);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store as any}>
        <MessageList
          user={{ xmppUsername: SELF, walletAddress: SELF } as any}
          roomJID={ROOM}
          loadMoreMessages={loadMore}
          loading={false}
          config={{ colors: { primary: '#0052CD', secondary: '#F3F6FC' } } as any}
          isReply={false}
          client={opts.client}
          onReadBoundaryChange={opts.onReadBoundaryChange}
        />
      </Provider>
    );
  });
  const list = () => tree.root.findByProps({ testID: 'mock-flat-list' });
  const layout = async (viewport: number, content: number) => {
    await act(async () => {
      list().props.onLayout({ nativeEvent: { layout: { height: viewport } } });
      list().props.onContentSizeChange(0, content);
    });
  };
  return { tree, list, layout, loadMore };
};

const run = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockScrollToOffset.mockReset();
  mockScrollToIndex.mockReset();
  clearJumpThread();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('MessageList: paging guard recovery', () => {
  it('retries a stuck request exactly once, with a delay, then stops (no busy loop)', async () => {
    const store = makeStore();
    seed(store);
    const { layout, loadMore } = await setup(store);
    await layout(800, 300);
    await run(500);
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(loadMore).toHaveBeenCalledWith(ROOM, HISTORY_PAGE_SIZE, 900_000);
    await run(1000);
    expect(loadMore).toHaveBeenCalledTimes(2);
    await run(10_000);
    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  it('allows the same key again after the cursor moved and regressed', async () => {
    const store = makeStore();
    seed(store);
    const { layout, loadMore } = await setup(store);
    await layout(800, 300);
    await run(3000);
    expect(loadMore).toHaveBeenCalledTimes(2);

    await act(async () => {
      store.dispatch(
        updateRoom({ jid: ROOM, updates: { messageStats: { firstMessageTimestamp: 800_000 } as any } })
      );
    });
    await run(3000);
    const afterMove = loadMore.mock.calls.length;
    expect(afterMove).toBeGreaterThan(2);
    await act(async () => {
      store.dispatch(
        updateRoom({ jid: ROOM, updates: { messageStats: { firstMessageTimestamp: 900_000 } as any } })
      );
    });
    await run(3000);
    expect(loadMore.mock.calls.length).toBeGreaterThan(afterMove);
    expect(loadMore.mock.calls[loadMore.mock.calls.length - 1][2]).toBe(900_000);
  });

  it('historyComplete stops it, including a pending retry', async () => {
    const store = makeStore();
    seed(store);
    const { layout, loadMore } = await setup(store);
    await layout(800, 300);
    await run(500);
    expect(loadMore).toHaveBeenCalledTimes(1);
    await act(async () => {
      store.dispatch(updateRoom({ jid: ROOM, updates: { historyComplete: true } }));
    });
    await run(10_000);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('a short complete room does nothing', async () => {
    const store = makeStore();
    seed(store, { historyComplete: true });
    const { layout, loadMore } = await setup(store);
    await layout(800, 300);
    await run(10_000);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('reads the latest room at call time: pages from the cursor, not a stale list position', async () => {
    const store = makeStore();
    seed(store);
    const { layout, loadMore } = await setup(store);
    await act(async () => {
      store.dispatch(
        updateRoom({ jid: ROOM, updates: { messageStats: { firstMessageTimestamp: 400_000 } as any } })
      );
    });
    await layout(800, 300);
    await run(500);
    expect(loadMore.mock.calls[0][2]).toBe(400_000);
  });

  it('a promise that never rejects is enough: a throwing loader does not wedge the list', async () => {
    const store = makeStore();
    seed(store);
    const loadMore = jest.fn().mockRejectedValue(new Error('boom'));
    const { layout } = await setup(store, { loadMore });
    await layout(800, 300);
    await run(3000);
    expect(loadMore.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('MessageList: auto-fills a viewport that cannot scroll', () => {
  const movingLoader = (store: Store, completeAt?: number) => {
    let cursor = 900_000;
    const fn: jest.Mock = jest.fn().mockImplementation(async () => {
      // A page of receipts: nothing displayed, the server cursor moves.
      cursor -= 1000;
      store.dispatch(
        updateRoom({
          jid: ROOM,
          updates: {
            messageStats: { firstMessageTimestamp: cursor } as any,
            historyComplete: completeAt !== undefined && fn.mock.calls.length >= completeAt,
          },
        })
      );
    });
    return fn;
  };

  it('keeps requesting older history with no scroll event while the viewport is unfilled', async () => {
    const store = makeStore();
    seed(store);
    const loadMore = movingLoader(store);
    const { layout } = await setup(store, { loadMore });
    await layout(800, 300);
    await run(2000);
    expect(loadMore.mock.calls.length).toBeGreaterThan(5);
  });

  it('stops when history becomes complete', async () => {
    const store = makeStore();
    seed(store);
    const loadMore = movingLoader(store, 3);
    const { layout } = await setup(store, { loadMore });
    await layout(800, 300);
    await run(3000);
    expect(loadMore).toHaveBeenCalledTimes(3);
  });

  it('stops at the idle cap when pages never add messages', async () => {
    const store = makeStore();
    seed(store);
    const loadMore = movingLoader(store);
    const { layout } = await setup(store, { loadMore });
    await layout(800, 300);
    await run(30_000);
    expect(loadMore).toHaveBeenCalledTimes(MAX_IDLE_AUTO_PAGES);
  });

  it('does nothing until the list has been laid out', async () => {
    const store = makeStore();
    seed(store);
    const { loadMore } = await setup(store);
    await run(2000);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('does not ask while the content already fills the viewport far ahead', async () => {
    const store = makeStore();
    seed(store);
    const { layout, loadMore } = await setup(store);
    await layout(800, 20_000);
    await run(2000);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('does nothing while a jump to this room is pending', async () => {
    const store = makeStore();
    seed(store);
    const { layout, loadMore } = await setup(store);
    // A thread owns the jump, so this list stays out of it and only the
    // pending request itself is under test.
    act(() => {
      setJumpThread({ roomJID: ROOM, parentId: 'p', at: Date.now(), parent: null, replies: [] });
    });
    act(() => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: ['x'] }));
    });
    await layout(800, 300);
    await run(1500);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('prefetches ahead of the viewport: FlatList is told to trigger several screens early', async () => {
    const store = makeStore();
    seed(store);
    const { list } = await setup(store);
    expect(list().props.onEndReachedThreshold).toBeGreaterThanOrEqual(3);
    expect(list().props.inverted).toBe(true);
  });

  it('onEndReached asks for the page before the cursor', async () => {
    const store = makeStore();
    seed(store);
    const { list, loadMore } = await setup(store);
    await act(async () => {
      list().props.onEndReached();
    });
    expect(loadMore).toHaveBeenCalledWith(ROOM, HISTORY_PAGE_SIZE, 900_000);
  });
});

describe('MessageList with a jump window', () => {
  const windowMessages = [msg(100), msg(200), msg(300), msg(400), msg(500)];
  const win = (over: Record<string, unknown> = {}) => ({
    roomJID: ROOM,
    messages: windowMessages,
    targetId: '300',
    olderCursor: 100,
    hasOlder: false,
    newerCursor: 500,
    hasNewer: false,
    ...over,
  });
  const live = [msg(1_000_000), msg(1_001_000), msg(1_002_000)];

  const page = (over: Record<string, unknown> = {}) => ({
    ok: true,
    messages: [] as any[],
    complete: false,
    first: null as number | null,
    last: null as number | null,
    ...over,
  });

  it('renders the window instead of the live list, newest first, and anchors appended rows', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const { list } = await setup(store);
    expect(list().props.data.map((m: any) => m.id)).toEqual(['1002000', '1001000', '1000000']);
    expect(list().props.maintainVisibleContentPosition).toBeUndefined();

    await act(async () => {
      store.dispatch(setJumpWindow(win() as any));
    });
    expect(list().props.data.map((m: any) => m.id)).toEqual(['500', '400', '300', '200', '100']);
    expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  });

  it('"Jump to latest" clears the window and shows the live tail', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const { tree, list } = await setup(store);
    await act(async () => {
      store.dispatch(setJumpWindow(win() as any));
    });
    mockScrollToOffset.mockClear();
    const button = tree.root.findByProps({ testID: 'jump-to-latest' });
    await act(async () => {
      button.props.onPress();
    });
    await run(100);
    expect((store.getState() as any).rooms.jumpWindow).toBeNull();
    expect(list().props.data.map((m: any) => m.id)).toEqual(['1002000', '1001000', '1000000']);
    expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(tree.root.findAllByProps({ testID: 'jump-to-latest' })).toHaveLength(0);
  });

  it('live arrivals appear once the reader is back on the live list', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const { tree, list } = await setup(store);
    // The window is far from the tail (hasNewer): the arrival is not part of it.
    await act(async () => {
      store.dispatch(setJumpWindow(win({ hasNewer: true }) as any));
    });
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: ROOM, message: msg(1_003_000) }));
    });
    // Not in the window, not on screen.
    expect(list().props.data.map((m: any) => m.id)).not.toContain('1003000');
    await act(async () => {
      tree.root.findByProps({ testID: 'jump-to-latest' }).props.onPress();
    });
    expect(list().props.data[0].id).toBe('1003000');
  });

  it('sending an own message leaves the window', async () => {
    const store = makeStore();
    seed(store, {}, live);
    await setup(store);
    await act(async () => {
      store.dispatch(setJumpWindow(win() as any));
    });
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: ROOM, message: msg(1_003_000, SELF) }));
    });
    expect((store.getState() as any).rooms.jumpWindow).toBeNull();
  });

  it('does not prefetch the live list while a window is shown', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const { layout, loadMore } = await setup(store);
    await act(async () => {
      store.dispatch(setJumpWindow(win() as any));
    });
    await layout(800, 300);
    await run(3000);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('keeps the read boundary at the live tail while the window is shown', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const onReadBoundaryChange = jest.fn();
    const { list, layout } = await setup(store, { onReadBoundaryChange });
    await layout(800, 2000);
    onReadBoundaryChange.mockClear();
    await act(async () => {
      store.dispatch(setJumpWindow(win() as any));
    });
    // Reading old history is not reading the latest messages: never "all read".
    expect(onReadBoundaryChange).toHaveBeenCalledWith(1_002_000);
    onReadBoundaryChange.mockClear();
    await act(async () => {
      // The window sits at offset 0 (its newest end): still not "at the bottom".
      list().props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
    });
    expect(onReadBoundaryChange).not.toHaveBeenCalledWith(null);
  });

  it('pages older then newer through the window helpers, with a spinner at each edge', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const getHistoryWindow = jest.fn(async (_j: string, _m: number, cursor: any) =>
      cursor.before !== undefined
        ? page({ messages: [msg(60), msg(80)], first: 60 })
        : page({ messages: [msg(600), msg(700)], last: 700, complete: true })
    );
    const client = { getHistoryWindow, getHistoryStanza: jest.fn() };
    const { list, layout } = await setup(store, { client });
    await act(async () => {
      store.dispatch(
        setJumpWindow(win({ hasOlder: true, hasNewer: true }) as any)
      );
    });
    await layout(800, 1000);
    await run(WINDOW_SETTLE_MS + 300);
    expect(getHistoryWindow).toHaveBeenCalledWith(ROOM, 20, { before: 100 });
    const state = (store.getState() as any).rooms.jumpWindow;
    expect(state.messages.map((m: any) => m.id)).toContain('60');
    // The older page lands first, the newer one follows without another scroll.
    await run(500);
    expect(getHistoryWindow).toHaveBeenCalledWith(ROOM, 20, { after: 500 });
    const after = (store.getState() as any).rooms.jumpWindow;
    expect(after.messages.map((m: any) => m.id)).toEqual(
      expect.arrayContaining(['60', '80', '600', '700'])
    );
    expect(after.hasNewer).toBe(false);
    expect(list().props.data.length).toBe(9);
  });

  it('shows a spinner at the edge while a window page is loading', async () => {
    const store = makeStore();
    seed(store, {}, live);
    let release!: (value: any) => void;
    const getHistoryWindow = jest.fn(
      () => new Promise((resolve) => { release = resolve; })
    );
    const client = { getHistoryWindow, getHistoryStanza: jest.fn() };
    const { tree, layout } = await setup(store, { client });
    await act(async () => {
      store.dispatch(setJumpWindow(win({ hasOlder: true }) as any));
    });
    await layout(800, 1000);
    await run(WINDOW_SETTLE_MS + 200);
    expect(tree.root.findAllByProps({ testID: 'history-loader-older' }).length).toBeGreaterThan(0);
    await act(async () => {
      release(page({ messages: [], complete: true }));
    });
    await run(200);
    expect(tree.root.findAllByProps({ testID: 'history-loader-older' })).toHaveLength(0);
  });

  it('does not page before the target scroll has settled', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const getHistoryWindow = jest.fn(async () => page());
    const client = { getHistoryWindow, getHistoryStanza: jest.fn() };
    const { layout } = await setup(store, { client });
    await act(async () => {
      store.dispatch(setJumpWindow(win({ hasOlder: true, hasNewer: true }) as any));
    });
    await layout(800, 1000);
    await run(WINDOW_SETTLE_MS - 200);
    expect(getHistoryWindow).not.toHaveBeenCalled();
  });

  it('leaves the window when the reader scrolls to a live tail with nothing newer', async () => {
    const store = makeStore();
    seed(store, {}, live);
    const { list, layout } = await setup(store);
    await act(async () => {
      store.dispatch(setJumpWindow(win() as any));
    });
    await layout(800, 3000);
    await run(WINDOW_EXIT_GRACE_MS + 100);
    await act(async () => {
      list().props.onScroll({
        nativeEvent: {
          contentOffset: { y: 0 },
          contentSize: { height: 3000 },
          layoutMeasurement: { height: 800 },
        },
      });
    });
    expect((store.getState() as any).rooms.jumpWindow).toBeNull();
  });
});

describe('MessageList: a far jump end to end', () => {
  const T = 1_700_000_000_000_000;
  const arch = (offsetMs: number) =>
    ({
      id: String(T + offsetMs * 1000),
      body: `a${offsetMs}`,
      date: new Date(1_700_000_000_000 + offsetMs).toISOString(),
      roomJid: ROOM,
      showInChannel: 'true',
      user: { id: PEER, name: 'Someone', token: '', refreshToken: '' },
    }) as any;
  const liveMsgs = Array.from({ length: 5 }, (_, i) => ({
    ...arch(1_000_000 + i),
    body: `live${i}`,
  }));
  const target = arch(0);

  const clientFor = (older: any[], newer: any[]) => ({
    getHistoryStanza: jest.fn(),
    getHistoryWindow: jest.fn(async (_j: string, _m: number, cursor: any) =>
      cursor.before !== undefined
        ? { ok: true, messages: older, complete: false, first: Number(older[0]?.id ?? null), last: null }
        : { ok: true, messages: newer, complete: false, first: null, last: Number(newer[newer.length - 1].id) }
    ),
  });

  it('opens a window around a message that is not loaded, scrolls to it, then highlights its bubble', async () => {
    const { getBubbleHighlightUntil } = require('../src/helpers/bubbleHighlight');
    const store = makeStore();
    seed(store, {}, liveMsgs);
    const client = clientFor([arch(-2), arch(-1)], [target, arch(1), arch(2)]);
    const { list } = await setup(store, { client });
    await act(async () => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: [target.id] }));
    });
    await run(50);
    const win = (store.getState() as any).rooms.jumpWindow;
    expect(win.targetId).toBe(target.id);
    // Newest first: a2, a1, a0 (target), a-1, a-2.
    expect(list().props.data.map((m: any) => m.id)).toEqual(
      [arch(2), arch(1), target, arch(-1), arch(-2)].map((m) => m.id)
    );
    expect(mockScrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2, viewPosition: 0.5 })
    );
    expect((store.getState() as any).rooms.pendingJump).toBeNull();
    expect(getBubbleHighlightUntil(target.id)).toBe(0);
    await run(600);
    expect(getBubbleHighlightUntil(target.id)).toBeGreaterThan(Date.now());
    await run(1200);
    expect(getBubbleHighlightUntil(target.id)).toBe(0);
  });

  it('shows the archived message instead of an error when the server says it is gone', async () => {
    const store = makeStore();
    seed(store, {}, liveMsgs);
    const client = clientFor([arch(-2)], [arch(5)]);
    await setup(store, { client });
    await act(async () => {
      store.dispatch(
        requestJumpToMessage({
          roomJID: ROOM,
          ids: [target.id],
          preview: { roomJID: ROOM, sender: 'Ann', body: 'old text', createdAt: '2020-01-01T00:00:00Z' },
        })
      );
    });
    await run(50);
    expect((store.getState() as any).rooms.archivedMessage?.body).toBe('old text');
    expect((store.getState() as any).rooms.jumpWindow).toBeNull();
  });

  it('keeps the plain scroll path for a message already in the live list', async () => {
    const store = makeStore();
    seed(store, {}, liveMsgs);
    const client = clientFor([], [target]);
    await setup(store, { client });
    await act(async () => {
      store.dispatch(requestJumpToMessage({ roomJID: ROOM, ids: [liveMsgs[1].id] }));
    });
    await run(50);
    expect(client.getHistoryWindow).not.toHaveBeenCalled();
    // Newest first: live4, live3, live2, live1 -> row 3.
    expect(mockScrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 3 }));
  });
});
