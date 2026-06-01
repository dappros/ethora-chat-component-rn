import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

const mockFlatListScrollToOffset = jest.fn();

jest.mock('react-native', () => {
  const React = require('react');
  const RN = jest.requireActual('react-native');

  const FlatList = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      scrollToOffset: mockFlatListScrollToOffset,
    }));

    return React.createElement(
      RN.View,
      {
        testID: 'mock-flat-list',
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
    ...RN,
    FlatList,
  };
});

import roomsReducer, {
  addRoom,
  addRoomMessage,
  setCurrentRoom,
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

const seedRoom = (store: ReturnType<typeof makeStore>, messages: any[]) => {
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
      } as any,
    })
  );
  store.dispatch(setCurrentRoom({ roomJID: ROOM }));
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
    seedRoom(store, [
      makeMessage(1710000000000, 'old-1'),
      makeMessage(1710000001000, 'old-2'),
    ]);

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
    });

    await act(async () => {
      store.dispatch(
        addRoomMessage({
          roomJID: ROOM,
          message: makeMessage(1710000002000, 'new-message'),
        })
      );
    });

    await act(async () => {
      flatList.props.onContentSizeChange?.();
    });

    expect(mockFlatListScrollToOffset).not.toHaveBeenCalled();
  });

  it('renders a local "New messages" divider when messages arrive above the current viewport', async () => {
    const store = makeStore();
    seedRoom(store, [
      makeMessage(1710000000000, 'old-1'),
      makeMessage(1710000001000, 'old-2'),
    ]);

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

    const labels = tree.root.findAll(
      (node) => typeof node.props?.children === 'string' && node.props.children === 'New messages'
    );

    expect(labels.length).toBeGreaterThan(0);
  });
});
