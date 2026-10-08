import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  addRoom,
  setCurrentRoom,
  setLogoutState,
  updateRoom,
} from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import ChatProfileModal, {
  MEMBER_PAGE_SIZE,
} from '../src/components/Modals/ChatProfileModal/ChatProfileModal';

const mockDirectory: { members: any[]; state: string } = {
  members: [],
  state: 'idle',
};
const mockUseRoomDirectory = jest.fn((_jid?: string, _enabled?: boolean) => mockDirectory);
jest.mock('../src/hooks/useRoomDirectory', () => ({
  useRoomDirectory: (jid?: string, enabled?: boolean) =>
    mockUseRoomDirectory(jid, enabled),
}));

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({
    client: { getRoomMembersStanza: jest.fn() },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const JID = 'big@conference.xmpp.example.com';
const person = (i: number, first = 'Dir') => ({
  _id: `id${i}`,
  firstName: first,
  lastName: `P${i}`,
  xmppUsername: `app_user${i}`,
});
const known = [person(0, 'Known'), person(1, 'Known'), person(2, 'Known')];

const seed = async (usersCnt: number) => {
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'big',
          title: 'Big room',
          usersCnt,
          messages: [],
          isLoading: false,
          roomBg: '',
        },
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: JID }));
    store.dispatch(
      updateRoom({
        jid: JID,
        updates: { type: 'public', role: 'participant', roomMembers: known },
      })
    );
    store.dispatch(setUser({ xmppUsername: 'me' } as any));
    store.dispatch(setConfig({} as any));
  });
};

const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ChatProfileModal handleCloseModal={jest.fn()} />
      </Provider>,
      { createNodeMock: () => ({ scrollTo: jest.fn(), focus: jest.fn() }) }
    );
  });
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .map((n) =>
        (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
          .filter((c: unknown) => typeof c === 'string')
          .join('')
          .trim()
      )
      .filter(Boolean) as string[];
  const byId = (id: string) => tree.root.findAll((n) => n.props?.testID === id);
  // each member row renders exactly one Pressable-less name Text: count the
  // "<first> <last>" labels
  const names = () => texts().filter((t) => /^(Known|Dir) P\d+$/.test(t));
  return { tree, texts, byId, names };
};

beforeEach(() => {
  mockDirectory.members = [];
  mockDirectory.state = 'idle';
  mockUseRoomDirectory.mockClear();
});

describe('ChatProfileModal room directory', () => {
  it('does not enable the directory when every member is loaded', async () => {
    await seed(3);
    await render();
    expect(mockUseRoomDirectory).toHaveBeenLastCalledWith(JID, false);
  });

  it('enables the directory and shows the true total for a truncated room', async () => {
    await seed(120);
    const { texts } = await render();
    expect(mockUseRoomDirectory).toHaveBeenLastCalledWith(JID, true);
    expect(texts().some((t) => t.includes('120'))).toBe(true);
  });

  it('shows the loading text while the directory loads', async () => {
    await seed(120);
    mockDirectory.state = 'loading';
    const { texts, byId } = await render();
    expect(byId('chat-profile-members-loading').length).toBeGreaterThan(0);
    expect(texts()).toContain('Loading all members...');
  });

  it('lists known members first, dedupes the directory, and renders 50 rows at a time', async () => {
    await seed(120);
    // 119 directory entries, the first 3 repeat the known members
    mockDirectory.members = [
      ...known,
      ...Array.from({ length: 117 }, (_, i) => person(i + 3)),
    ];
    mockDirectory.state = 'done';
    const { names, byId } = await render();
    const first = names();
    expect(first).toHaveLength(MEMBER_PAGE_SIZE);
    expect(first.slice(0, 3)).toEqual(['Known P0', 'Known P1', 'Known P2']);
    expect(new Set(first).size).toBe(first.length);
    expect(byId('chat-profile-members-show-more').length).toBeGreaterThan(0);

    const more = byId('chat-profile-members-show-more').find(
      (n) => typeof n.props.onPress === 'function'
    )!;
    await act(async () => {
      more.props.onPress();
    });
    expect(names()).toHaveLength(MEMBER_PAGE_SIZE * 2);
    await act(async () => {
      byId('chat-profile-members-show-more')
        .find((n) => typeof n.props.onPress === 'function')!
        .props.onPress();
    });
    // 120 unique people: 3 known + 117 directory
    expect(names()).toHaveLength(120);
    expect(byId('chat-profile-members-show-more')).toHaveLength(0);
  });

  it('searches the whole directory, not only the rows already shown', async () => {
    await seed(120);
    mockDirectory.members = Array.from({ length: 117 }, (_, i) => person(i + 3));
    mockDirectory.state = 'done';
    const { names, byId } = await render();
    // the field only mounts once the hero's search action is pressed
    expect(names()).toHaveLength(MEMBER_PAGE_SIZE);
    const searchAction = byId('chat-profile-action-search');
    expect(searchAction.length).toBeGreaterThan(0);
    await act(async () => {
      searchAction
        .find((n) => typeof n.props.onPress === 'function')!
        .props.onPress();
    });
    const input = byId('chat-profile-member-search').find(
      (n) => typeof n.props.onChangeText === 'function'
    )!;
    await act(async () => {
      input.props.onChangeText('P119');
    });
    expect(names()).toEqual(['Dir P119']);
  });
});
