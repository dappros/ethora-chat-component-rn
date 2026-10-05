import React from 'react';
import { AccessibilityInfo } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import roomsReducer, {
  showArchivedMessage,
} from '../src/roomStore/roomsSlice';
import { BubbleHighlight } from '../src/components/MessageBubble/BubbleHighlight';
import ArchivedMessageCard from '../src/components/MainComponents/ArchivedMessageCard';
import {
  HIGHLIGHT_MS,
  getBubbleHighlightUntil,
  setBubbleHighlight,
} from '../src/helpers/bubbleHighlight';

const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });

const flush = async (ms = 0) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const rings = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAllByProps({ testID: 'bubble-highlight' }).filter(
    (node) => typeof node.type !== 'function'
  );

describe('bubble highlight', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    setBubbleHighlight(null);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    setBubbleHighlight(null);
  });

  it('draws nothing for a message without a highlight', async () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BubbleHighlight messageId="m1" />);
    });
    await flush();
    expect(rings(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('pulses the highlighted bubble for one second, and only that bubble', async () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <>
          <BubbleHighlight messageId="m1" />
          <BubbleHighlight messageId="m2" />
        </>
      );
    });
    act(() => setBubbleHighlight('m1'));
    await flush();
    expect(rings(tree)).toHaveLength(1);
    await flush(HIGHLIGHT_MS - 100);
    expect(rings(tree)).toHaveLength(1);
    await flush(200);
    expect(rings(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('is not a scale transform: the ring is a border and a tint of the brand colour', async () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BubbleHighlight messageId="m1" />);
    });
    act(() => setBubbleHighlight('m1'));
    await flush();
    const flat = Object.assign({}, ...[].concat(rings(tree)[0].props.style as any));
    expect(flat.borderWidth).toBeGreaterThan(0);
    expect(flat.borderColor).toBeTruthy();
    expect(flat.transform).toBeUndefined();
    act(() => tree.unmount());
  });

  it('is applied again when the row remounts during that second', async () => {
    act(() => setBubbleHighlight('m1'));
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BubbleHighlight messageId="m1" />);
    });
    await flush(300);
    act(() => tree.unmount());
    await flush(300);
    act(() => {
      tree = renderer.create(<BubbleHighlight messageId="m1" />);
    });
    await flush();
    expect(rings(tree)).toHaveLength(1);
    // The second is not restarted by the remount.
    await flush(500);
    expect(rings(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('shows a static ring when reduce motion is on', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<BubbleHighlight messageId="m1" />);
    });
    act(() => setBubbleHighlight('m1'));
    await flush();
    const opacityNow = () => {
      const style = Object.assign({}, ...[].concat(rings(tree)[0].props.style as any));
      const value = style.opacity;
      return typeof value === 'number' ? value : value.__getValue();
    };
    expect(opacityNow()).toBe(1);
    await flush(300);
    expect(opacityNow()).toBe(1);
    await flush(HIGHLIGHT_MS);
    expect(rings(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('keeps the highlight end time in the store', () => {
    setBubbleHighlight('m1', 1000);
    expect(getBubbleHighlightUntil('m1')).toBe(1000 + HIGHLIGHT_MS);
    expect(getBubbleHighlightUntil('m2')).toBe(0);
  });
});

describe('ArchivedMessageCard', () => {
  const ROOM = 'room@conference.example.com';
  const card = {
    roomJID: ROOM,
    sender: 'Ann',
    body: 'an old message',
    createdAt: '2020-01-01T10:00:00.000Z',
  };

  it('shows the hit for its own room, and closes', () => {
    const store = makeStore();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Provider store={store as any}>
          <ArchivedMessageCard roomJID={ROOM} />
        </Provider>
      );
    });
    expect(tree.root.findAllByProps({ testID: 'archived-message-card' })).toHaveLength(0);
    act(() => {
      store.dispatch(showArchivedMessage(card));
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('an old message');
    expect(json).toContain('Ann');
    expect(json).toContain('Older message');
    act(() => {
      tree.root.findByProps({ testID: 'archived-message-close' }).props.onPress();
    });
    expect((store.getState() as any).rooms.archivedMessage).toBeNull();
    act(() => tree.unmount());
  });

  it('ignores a hit of another room', () => {
    const store = makeStore();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Provider store={store as any}>
          <ArchivedMessageCard roomJID="other@conference.example.com" />
        </Provider>
      );
    });
    act(() => {
      store.dispatch(showArchivedMessage(card));
    });
    expect(tree.root.findAllByProps({ testID: 'archived-message-card' })).toHaveLength(0);
    act(() => tree.unmount());
  });
});
