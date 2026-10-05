import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import roomsReducer, {
  requestJumpToMessage,
  setJumpWindow,
} from '../src/roomStore/roomsSlice';
import {
  HIGHLIGHT_SETTLE_MS,
  NEAR_LIVE_MESSAGES,
  useJumpToMessage,
} from '../src/hooks/useJumpToMessage';
import { clearJumpThread, setJumpThread } from '../src/helpers/jumpThread';

const ROOM = 'room@conference.example.com';
const mk = (n: number, extra: Record<string, unknown> = {}) =>
  ({
    id: String(1_700_000_000_000_000 + n * 1000),
    body: `b${n}`,
    date: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    roomJid: ROOM,
    user: {},
    ...extra,
  }) as any;
const list = (count: number) => Array.from({ length: count }, (_, i) => mk(i));
const PREVIEW = { roomJID: ROOM, sender: 's', body: 'x', createdAt: 'x' };

// The hook re-arms a short timer after each answer, so the clock has to move in
// steps for each re-armed timer to be reached.
const stepClock = async (totalMs: number, stepMs = 100) => {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await act(async () => {
      jest.advanceTimersByTime(stepMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
};

interface SetupProps {
  messages: any[];
  allMessages?: any[];
  scope?: 'main' | { threadId: string };
  resolveReply?: any;
  fetchWindow?: any;
  roomOpening?: boolean;
  fetchOlderPage?: any;
  jumpWindowActive?: boolean;
  historyComplete?: boolean;
  jump?: Record<string, unknown>;
}

const setup = (props: SetupProps) => {
  const store = configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer } as any,
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
  const scrollToIndex = jest.fn();
  const onHighlight = jest.fn();
  const fetchOlderPage =
    props.fetchOlderPage ??
    jest.fn().mockResolvedValue({ ok: true, complete: true, cursor: 1 });
  const Probe = () => {
    useJumpToMessage({
      roomJID: ROOM,
      messages: props.messages,
      listData: props.messages.slice().reverse(),
      allMessages: props.allMessages,
      scrollToIndex,
      onHighlight,
      fetchOlderPage,
      historyComplete: props.historyComplete ?? false,
      isUserAtBottomRef: { current: true },
      jumpWindowActive: props.jumpWindowActive,
      fetchWindow: props.fetchWindow,
      resolveReply: props.resolveReply,
      scope: props.scope,
      roomOpening: props.roomOpening,
    });
    return null;
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <Provider store={store as any}>
        <Probe />
      </Provider>
    );
  });
  const jump = (target: any = mk(0), extra: any = {}) =>
    act(async () => {
      store.dispatch(
        requestJumpToMessage({
          roomJID: ROOM,
          ids: [target.id],
          preview: PREVIEW as any,
          ...(props.jump ?? {}),
          ...extra,
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  return {
    store,
    tree,
    scrollToIndex,
    onHighlight,
    fetchOlderPage,
    jump,
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  clearJumpThread();
});
afterEach(() => {
  jest.useRealTimers();
  clearJumpThread();
});

describe('useJumpToMessage: window or existing path', () => {
  it('keeps the scroll path for a target near the live tail', async () => {
    const messages = list(NEAR_LIVE_MESSAGES + 50);
    const fetchWindow = jest.fn().mockResolvedValue('found');
    const { jump, store, scrollToIndex } = setup({ messages, fetchWindow });
    await jump(messages[messages.length - 10]);
    await stepClock(50);
    expect(fetchWindow).not.toHaveBeenCalled();
    // listData is newest first: the 10th from the end is row 9.
    expect(scrollToIndex).toHaveBeenCalledWith(9);
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('fetches a window for a target far from the tail instead of paging', async () => {
    const messages = list(NEAR_LIVE_MESSAGES + 200);
    const fetchWindow = jest.fn().mockResolvedValue('found');
    const { jump, fetchOlderPage } = setup({ messages, fetchWindow });
    await jump(messages[5]);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
    expect(fetchOlderPage).not.toHaveBeenCalled();
  });

  it('fetches a window for a target that is not loaded at all', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('found');
    const { jump } = setup({ messages: list(30), fetchWindow });
    await jump(mk(9999));
    expect(fetchWindow).toHaveBeenCalledTimes(1);
  });

  it('shows the archived card when the server says the target is gone', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('missing');
    const { jump, store, fetchOlderPage } = setup({
      messages: list(30),
      fetchWindow,
    });
    await jump(mk(9999));
    await stepClock(10);
    expect(fetchOlderPage).not.toHaveBeenCalled();
    expect(store.getState().rooms.archivedMessage).not.toBeNull();
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('never emits an error toast for a hit that has a preview', async () => {
    const { toastEmitter } = require('../src/utils/toastEmitter');
    const toasts: any[] = [];
    const off = toastEmitter.subscribe((t: any) => toasts.push(t));
    const fetchWindow = jest.fn().mockResolvedValue('missing');
    const { jump } = setup({ messages: list(30), fetchWindow });
    await jump(mk(9999));
    await stepClock(10);
    off();
    expect(toasts).toHaveLength(0);
  });

  it('falls back to paging by the server cursor when a window could not be asked for', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('unavailable');
    const messages = list(30);
    const { jump, fetchOlderPage } = setup({ messages, fetchWindow });
    await jump(mk(9999));
    await stepClock(10);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
    // First page: before the oldest displayed message.
    expect(fetchOlderPage).toHaveBeenCalledWith(
      ROOM,
      Number(messages[0].id),
      100
    );
  });

  it('stops paging when the server says the history is complete', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('unavailable');
    const { jump, store } = setup({ messages: list(30), fetchWindow });
    await jump(mk(9999));
    await stepClock(200);
    // fetchOlderPage answers complete: nothing older, so the hit is shown as is.
    expect(store.getState().rooms.archivedMessage).not.toBeNull();
    expect(store.getState().rooms.pendingJump).toBeNull();
  });

  it('stops after repeated failures instead of paging forever', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('unavailable');
    const fetchOlderPage = jest.fn().mockResolvedValue({ ok: false });
    const { jump, store } = setup({
      messages: list(30),
      fetchWindow,
      fetchOlderPage,
    });
    await jump(mk(9999));
    await stepClock(500);
    expect(fetchOlderPage).toHaveBeenCalledTimes(3);
    expect(store.getState().rooms.archivedMessage).not.toBeNull();
  });

  it('scrolls within the window when the target is in it, then highlights', async () => {
    const messages = list(21);
    const fetchWindow = jest.fn();
    const { jump, scrollToIndex, onHighlight, store } = setup({
      messages,
      fetchWindow,
      jumpWindowActive: true,
    });
    await jump(messages[10]);
    await stepClock(50);
    expect(fetchWindow).not.toHaveBeenCalled();
    expect(scrollToIndex).toHaveBeenCalledWith(10);
    expect(store.getState().rooms.pendingJump).toBeNull();
    expect(onHighlight).not.toHaveBeenCalled();
    await stepClock(HIGHLIGHT_SETTLE_MS);
    expect(onHighlight).toHaveBeenCalledWith(messages[10].id);
    await stepClock(1100);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('returns to the live list when a new target is outside the window', async () => {
    const { jump, store } = setup({
      messages: list(21),
      fetchWindow: jest.fn(),
      jumpWindowActive: true,
    });
    act(() => {
      store.dispatch(
        setJumpWindow({
          roomJID: ROOM,
          messages: list(21),
          targetId: mk(10).id,
          olderCursor: null,
          hasOlder: false,
          newerCursor: null,
          hasNewer: false,
        })
      );
    });
    await jump(mk(9999));
    expect(store.getState().rooms.jumpWindow).toBeNull();
  });
});

describe('useJumpToMessage: one owner per jump', () => {
  it('a thread instance stays inert while no thread owns the jump', async () => {
    const { jump, store, fetchOlderPage } = setup({
      messages: [mk(5)],
      scope: { threadId: 'parent-1' },
    });
    await jump(mk(1));
    await stepClock(100);
    expect(store.getState().rooms.pendingJump).not.toBeNull();
    expect(store.getState().rooms.archivedMessage).toBeNull();
    expect(fetchOlderPage).not.toHaveBeenCalled();
  });

  it('the main instance stays inert once a thread owns the jump', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('missing');
    const { jump, store } = setup({
      messages: [mk(5)],
      scope: 'main',
      fetchWindow,
    });
    // The clock is frozen, so the request's `at` is known in advance.
    act(() => {
      setJumpThread({
        roomJID: ROOM,
        parentId: 'parent-1',
        at: Date.now(),
        parent: null,
        replies: [],
      });
    });
    await jump(mk(1));
    await stepClock(2000);
    expect(fetchWindow).not.toHaveBeenCalled();
    expect(store.getState().rooms.archivedMessage).toBeNull();
    expect(store.getState().rooms.pendingJump).not.toBeNull();
  });

  it('the owning thread scrolls to the reply and clears the jump', async () => {
    const reply = mk(1, { isReply: 'true' });
    const { jump, store, scrollToIndex } = setup({
      messages: [reply],
      scope: { threadId: 'parent-1' },
    });
    act(() => {
      setJumpThread({
        roomJID: ROOM,
        parentId: 'parent-1',
        at: Date.now(),
        parent: null,
        replies: [reply],
      });
    });
    await jump(reply);
    await stepClock(100);
    expect(scrollToIndex).toHaveBeenCalledWith(0);
    expect(store.getState().rooms.pendingJump).toBeNull();
  });
});

describe('useJumpToMessage: a target that is a thread reply', () => {
  const parentRef = JSON.stringify({ id: 'p1', roomJid: ROOM });

  it('hands a reply found in the unfiltered list to resolveReply, with no card', async () => {
    const reply = mk(1, { isReply: 'true', mainMessage: parentRef });
    const resolveReply = jest.fn(async (j: any) => {
      setJumpThread({
        roomJID: ROOM,
        parentId: 'p1',
        at: j.at,
        parent: null,
        replies: [],
      });
      return true;
    });
    const { jump, store, fetchOlderPage } = setup({
      messages: [mk(5)],
      allMessages: [reply, mk(5)],
      resolveReply,
    });
    await jump(reply);
    await stepClock(10);
    expect(resolveReply).toHaveBeenCalledTimes(1);
    expect(resolveReply.mock.calls[0][1].id).toBe(reply.id);
    expect(store.getState().rooms.archivedMessage).toBeNull();
    expect(fetchOlderPage).not.toHaveBeenCalled();
  });

  it('shows the card only when the thread could not be opened', async () => {
    const reply = mk(1, { isReply: 'true', mainMessage: parentRef });
    const resolveReply = jest.fn().mockResolvedValue(false);
    const { jump, store } = setup({
      messages: [mk(5)],
      allMessages: [reply, mk(5)],
      resolveReply,
    });
    await jump(reply);
    await stepClock(10);
    expect(store.getState().rooms.archivedMessage).not.toBeNull();
  });

  it('does not treat a reply also shown in the channel as a thread target', async () => {
    const shown = mk(1, {
      isReply: 'true',
      mainMessage: parentRef,
      showInChannel: 'true',
    });
    const resolveReply = jest.fn();
    const { jump, scrollToIndex } = setup({
      messages: [shown, mk(5)],
      allMessages: [shown, mk(5)],
      resolveReply,
    });
    await jump(shown);
    await stepClock(50);
    expect(resolveReply).not.toHaveBeenCalled();
    expect(scrollToIndex).toHaveBeenCalledWith(1);
  });
});

describe('useJumpToMessage: a room that is still opening', () => {
  it('asks again instead of showing the card when the window could not be asked yet', async () => {
    const fetchWindow = jest
      .fn()
      .mockResolvedValueOnce('unavailable')
      .mockResolvedValueOnce('unavailable')
      .mockResolvedValue('missing');
    const { jump, store } = setup({
      messages: [mk(5)],
      fetchWindow,
      roomOpening: true,
    });
    await jump(mk(1));
    await stepClock(10);
    expect(store.getState().rooms.archivedMessage).toBeNull();
    await stepClock(3000);
    expect(fetchWindow.mock.calls.length).toBeGreaterThanOrEqual(3);
    // The server finally answered "absent": now, and only now, the card.
    expect(store.getState().rooms.archivedMessage).not.toBeNull();
  });

  it('does not count failed page requests of an opening room toward giving up', async () => {
    const fetchOlderPage = jest.fn().mockResolvedValue({ ok: false });
    const { jump, store } = setup({
      messages: [mk(5)],
      roomOpening: true,
      fetchOlderPage,
    });
    await jump(mk(1));
    await stepClock(5000);
    expect(fetchOlderPage.mock.calls.length).toBeGreaterThan(3);
    expect(store.getState().rooms.archivedMessage).toBeNull();
  });

  it('waits for the live list of an empty opening room, then asks the archive', async () => {
    const fetchWindow = jest.fn().mockResolvedValue('found');
    const { jump } = setup({ messages: [], fetchWindow, roomOpening: true });
    await jump(mk(1));
    await stepClock(1000);
    expect(fetchWindow).not.toHaveBeenCalled();
    await stepClock(4000);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
  });
});

describe('useJumpToMessage: the request time limit', () => {
  it('drops a request nobody fulfilled and keeps the preview', async () => {
    const { jump, store } = setup({ messages: [] });
    await jump(mk(1));
    jest.setSystemTime(Date.now() + 61_000);
    await stepClock(1000);
    expect(store.getState().rooms.pendingJump).toBeNull();
    expect(store.getState().rooms.archivedMessage).not.toBeNull();
  });
});
