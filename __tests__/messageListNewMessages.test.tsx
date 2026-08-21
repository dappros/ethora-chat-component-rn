import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

const mockFlatListScrollToOffset = jest.fn();

jest.mock('react-native', () => {
  const React = require('react');

  const FlatList = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      scrollToOffset: mockFlatListScrollToOffset,
    }));

    return React.createElement(
      'View',
      {
        testID: 'mock-flat-list',
        data: props.data,
        onScroll: props.onScroll,
        onContentSizeChange: props.onContentSizeChange,
        onLayout: props.onLayout,
      },
      (props.data || []).map((item: any, index: number) =>
        React.createElement(
          React.Fragment,
          {
            key: props.keyExtractor
              ? props.keyExtractor(item, index)
              : String(index),
          },
          props.renderItem({ item, index })
        )
      ),
      props.ListFooterComponent || null
    );
  });

  return {
    View: ({ children, ...props }: any) =>
      React.createElement('View', props, children),
    Text: ({ children, ...props }: any) =>
      React.createElement('Text', props, children),
    Image: (props: any) => React.createElement('Image', props),
    TouchableOpacity: ({ children, ...props }: any) =>
      React.createElement('TouchableOpacity', props, children),
    StyleSheet: {
      create: (styles: any) => styles,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    // expo@57's winter runtime installs a lazy global `fetch` getter that
    // requires expo-modules-core on first touch, and that module reads
    // `Platform.select` from react-native at import time. Without Platform
    // in this mock the whole suite dies with "Cannot read properties of
    // undefined (reading 'select')".
    Platform: {
      OS: 'ios',
      select: (specifics: any) =>
        specifics?.ios ?? specifics?.native ?? specifics?.default,
    },
    Dimensions: {
      get: () => ({ width: 390, height: 844 }),
    },
    FlatList,
  };
});

jest.mock('../src/components/MainComponents/MessageContainer', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MessageContainer: ({ message }: any) =>
      React.createElement(
        Text,
        {},
        String(message?.id).startsWith('delimiter-new')
          ? 'New messages'
          : message?.body || ''
      ),
  };
});

jest.mock('../src/components/styled/StyledInputComponents/Composing', () => {
  return () => null;
});

jest.mock('../src/components/styled/StyledInputComponents/CustomTypingIndicator', () => {
  return () => null;
});

jest.mock('../src/components/styled/Loader', () => {
  return () => null;
});

jest.mock('../src/components/styled/TreadLabel', () => {
  return () => null;
});

jest.mock('../src/assets/icons', () => ({
  ArowDownIcon: () => null,
}));

import roomsReducer, {
  addRoom,
  addRoomMessage,
  setCurrentRoom,
  setLastViewedTimestamp,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import MessageList from '../src/components/MainComponents/MessageList';

const ROOM = 'room@conference.xmpp.chat.ethora.com';

const makeStore = () =>
  configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });

const makeMessage = (idMs: number, body: string) =>
  ({
    id: String(idMs),
    body,
    date: new Date(idMs).toISOString(),
    roomJid: ROOM,
    user: {
      id: 'other-user',
      name: 'Other User',
      token: '',
      refreshToken: '',
    },
    showInChannel: 'true',
  } as any);

const seedRoom = (
  store: ReturnType<typeof makeStore>,
  messages: any[],
  lastViewedTimestamp?: number
) => {
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
        lastViewedTimestamp,
      } as any,
    })
  );
  store.dispatch(setCurrentRoom({ roomJID: ROOM }));
  if (typeof lastViewedTimestamp !== 'undefined') {
    store.dispatch(
      setLastViewedTimestamp({
        chatJID: ROOM,
        timestamp: lastViewedTimestamp,
      })
    );
  }
};

const renderMessageList = async (store: ReturnType<typeof makeStore>) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <MessageList
          user={{ xmppUsername: 'self-user', walletAddress: 'self-user' } as any}
          roomJID={ROOM}
          loadMoreMessages={jest.fn().mockResolvedValue(undefined)}
          loading={false}
          config={{ colors: { primary: '#0052CD', secondary: '#F3F6FC' } } as any}
          isReply={false}
        />
      </Provider>
    );
  });
  return tree;
};

describe('MessageList new-message UX', () => {
  beforeEach(() => {
    mockFlatListScrollToOffset.mockReset();
  });

  it('does not auto-scroll when new content arrives while the user is scrolled up', async () => {
    const store = makeStore();
    seedRoom(
      store,
      [
        makeMessage(1710000000000, 'old-1'),
        makeMessage(1710000001000, 'old-2'),
      ],
      0
    );

    const tree = await renderMessageList(store);
    const flatList = tree.root.findByProps({ testID: 'mock-flat-list' });

    await act(async () => {
      flatList.props.onLayout?.();
      flatList.props.onContentSizeChange?.();
    });
    mockFlatListScrollToOffset.mockClear();

    await act(async () => {
      flatList.props.onScroll?.({
        nativeEvent: {
          contentOffset: { y: 280 },
        },
      });
      store.dispatch(
        addRoomMessage({
          roomJID: ROOM,
          message: makeMessage(1710000002000, 'new-message'),
        })
      );
      flatList.props.onContentSizeChange?.();
    });

    expect(mockFlatListScrollToOffset).not.toHaveBeenCalled();
  });

  it('renders a local "New messages" divider when messages arrive above the current viewport', async () => {
    const store = makeStore();
    seedRoom(
      store,
      [
        makeMessage(1710000000000, 'old-1'),
        makeMessage(1710000001000, 'old-2'),
      ],
      0
    );

    const tree = await renderMessageList(store);
    const flatList = tree.root.findByProps({ testID: 'mock-flat-list' });

    await act(async () => {
      flatList.props.onScroll?.({
        nativeEvent: {
          contentOffset: { y: 280 },
        },
      });
    });

    await act(async () => {
      store.dispatch(
        addRoomMessage({
          roomJID: ROOM,
          message: makeMessage(1710000002000, 'new-message'),
        })
      );
    });
    await act(async () => {});

    const updatedFlatList = tree.root.findByProps({ testID: 'mock-flat-list' });
    expect(updatedFlatList.props.data.length).toBeGreaterThanOrEqual(3);
    expect(
      updatedFlatList.props.data.some((item: any) =>
        String(item.id).startsWith('delimiter-new')
      )
    ).toBe(true);

    const labels = tree.root.findAll((node) =>
      Array.isArray(node.children)
        ? node.children.includes('New messages')
        : node.children === 'New messages'
    );

    expect(labels.length).toBeGreaterThan(0);
  });
});
