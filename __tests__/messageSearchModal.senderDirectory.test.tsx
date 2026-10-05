import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { addRoom, setCurrentRoom } from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';

const mockDir = { members: [] as any[], ensure: jest.fn() };
jest.mock('../src/helpers/userResolver', () => ({
  requestUsers: jest.fn(),
  ensureRoomDirectory: (...a: unknown[]) => mockDir.ensure(...a),
  getRoomDirectoryMembers: () => mockDir.members,
  getRoomDirectoryState: () => 'done',
  subscribeUserResolver: () => () => {},
}));
jest.mock('../src/networking/api-requests/messageSearch.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/messageSearch.api'),
  searchMessages: jest.fn().mockResolvedValue({
    items: [], total: 0, offset: 0, limit: 20, nextOffset: 0,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

import MessageSearchModal from '../src/components/Modals/MessageSearchModal/MessageSearchModal';

const JID = 'room1@conference.x';

const open = async (usersCnt: number) => {
  await act(async () => {
    store.dispatch(
      addRoom({
        roomData: {
          id: JID, jid: JID, name: 'room1', title: 'Room', usersCnt,
          messages: [], isLoading: false, roomBg: '',
        } as any,
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: JID }));
    store.dispatch(setUser({ xmppUsername: 'me' } as any));
    store.dispatch(setConfig({ appId: 'app', enableMessageSearch: true }));
    store.dispatch({
      type: 'roomMessages/updateRoom',
      payload: {
        jid: JID,
        updates: { usersCnt, members: [{ _id: 'u1', firstName: 'Ann', lastName: 'Lee' }] },
      },
    });
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <MessageSearchModal handleCloseModal={jest.fn()} />
      </Provider>,
      { createNodeMock: () => ({ focus: jest.fn() }) }
    );
  });
  const byId = (id: string) =>
    tree.root.findAll((n) => n.props?.testID === id && typeof n.type !== 'string');
  await act(async () => {
    byId('message-search-filters-toggle')[0].props.onPress();
  });
  return { byId };
};

beforeEach(() => {
  mockDir.members = [];
  mockDir.ensure.mockReset();
});

describe('sender filter on a truncated room', () => {
  it('loads the directory and offers directory users beyond the first members', async () => {
    mockDir.members = [{ _id: 'u2', firstName: 'Zed', lastName: 'Far', xmppUsername: 'app_u2' }];
    const { byId } = await open(435);
    expect(mockDir.ensure).toHaveBeenCalledWith(JID);
    await act(async () => {
      byId('message-search-sender-input')[0].props.onChangeText('Zed');
    });
    expect(byId('message-search-sender-u2').length).toBeGreaterThan(0);
  });

  it('does not load a directory for a complete room', async () => {
    await open(1);
    expect(mockDir.ensure).not.toHaveBeenCalled();
  });
});
