import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { addRoom, setLogoutState, updateRoom } from '../src/roomStore/roomsSlice';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import ChatHeader from '../src/components/MainComponents/ChatHeader';

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: { leaveTheRoomStanza: jest.fn() } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/components/MenuRoom/MenuRoom', () => ({ RoomMenu: () => null }));
jest.mock('../src/components/VideoCalls/CallButtons', () => ({
  CallButtons: () => null,
}));
jest.mock('../src/components/MainComponents/MessageSearchButton', () => ({
  MessageSearchButton: () => null,
}));
jest.mock('../src/components/MainComponents/LanguageSelectorButton', () => ({
  LanguageSelectorButton: () => null,
}));

const JID = 'big@conference.xmpp.example.com';
const members = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    _id: `i${i}`,
    firstName: 'M',
    lastName: String(i),
    xmppUsername: `u${i}`,
  }));

const seed = async (usersCnt: number, memberCount: number) => {
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(setConfig({} as any));
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'big',
          title: 'Big',
          usersCnt,
          messages: [],
          isLoading: false,
          roomBg: '',
        },
      })
    );
    store.dispatch(
      updateRoom({ jid: JID, updates: { members: members(memberCount), usersCnt } })
    );
  });
};

const renderHeader = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ChatHeader currentRoom={store.getState().rooms.rooms[JID]} />
      </Provider>
    );
  });
  return tree;
};

const deepText = (node: renderer.ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(deepText).join('');

const countLabel = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.numberOfLines === 'number')
    .find((n) => /\d+ users?$/.test(deepText(n)));

describe('ChatHeader user count', () => {
  it('shows usersCnt, not the truncated members length', async () => {
    await seed(435, 30);
    const tree = await renderHeader();
    expect(deepText(countLabel(tree)!)).toBe('435 users');
  });

  it('shows the larger of usersCnt and members.length', async () => {
    await seed(2, 5);
    const tree = await renderHeader();
    expect(deepText(countLabel(tree)!)).toBe('5 users');
  });

  it('keeps the count on one line so a narrow header does not wrap it', async () => {
    await seed(435, 30);
    const tree = await renderHeader();
    const label = countLabel(tree);
    expect(label).toBeDefined();
    expect(label!.props.numberOfLines).toBe(1);
    expect(label!.props.ellipsizeMode).toBe('tail');
  });
});
