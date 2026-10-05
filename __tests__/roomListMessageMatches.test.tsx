import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { addRoom } from '../src/roomStore/roomsSlice';
import RoomList from '../src/components/MainComponents/RoomList';
import { SearchInput } from '../src/components/InputComponents/Search';

const mockSearch = jest.fn();
jest.mock('../src/networking/api-requests/messageSearch.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/messageSearch.api'),
  searchMessages: (...a: unknown[]) => mockSearch(...a),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: {} }),
}));
jest.mock('../src/helpers/userResolver', () => ({
  requestUsers: jest.fn(),
  ensureRoomDirectory: jest.fn(),
  getRoomDirectoryMembers: () => [],
  getRoomDirectoryState: () => 'idle',
  subscribeUserResolver: () => () => {},
}));

const ONE = 'one@conference.x';
const TWO = 'two@conference.x';
const CHATS = [ONE, TWO].map((jid, i) => ({
  jid,
  id: jid,
  name: jid.split('@')[0],
  title: i ? 'Two' : 'One',
  usersCnt: 2,
  messages: [],
  isLoading: false,
  roomBg: '',
}));

const hit = (over: any = {}) => ({
  id: 'row1',
  chatId: 'two',
  chatType: 'groupchat',
  room: TWO,
  from: 'app_u1@x',
  fromUserId: 'u1',
  body: 'the invoice is here',
  messageId: 'm1',
  stanzaId: 's1',
  createdAt: '2026-03-04T10:00:00.000Z',
  ...over,
});
const page = (items: any[], total = items.length, offset = 0) => ({
  items,
  total,
  offset,
  limit: 20,
  nextOffset: offset + items.length,
});

const onRoomClick = jest.fn();

let mounted: renderer.ReactTestRenderer | null = null;

const render = async (config: any) => {
  await act(async () => {
    store.dispatch(setUser({ xmppUsername: 'me', token: 'jwt' } as any));
    store.dispatch(setConfig(config));
    for (const room of CHATS) {
      store.dispatch(addRoom({ roomData: room as any }));
    }
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <RoomList chats={CHATS as any} onRoomClick={onRoomClick} />
      </Provider>
    );
  });
  mounted = tree;
  const type = async (text: string) => {
    await act(async () => {
      tree.root.findByType(SearchInput).props.onChangeText(text);
    });
  };
  const advance = async (ms = 400) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const byId = (id: string) =>
    tree.root.findAll((n) => n.props?.testID === id && typeof n.type !== 'string');
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c) => typeof c === 'string') as string[];
  return { tree, type, advance, byId, texts };
};

const ON = { appId: 'app1', enableMessageSearch: true };

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
  onRoomClick.mockReset();
});
afterEach(() => {
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
  jest.useRealTimers();
});

describe('RoomList message matches', () => {
  it('makes no request and renders no block when message search is off', async () => {
    const { type, advance, byId } = await render({ appId: 'app1' });
    await type('invoice');
    await advance();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(byId('room-list-message-matches')).toHaveLength(0);
  });

  it('makes no request and renders no block below two characters', async () => {
    const { type, advance, byId } = await render(ON);
    await type('i');
    await advance();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(byId('room-list-message-matches')).toHaveLength(0);
  });

  it('searches all chats after the debounce and lists the matches with a count', async () => {
    mockSearch.mockResolvedValue(page([hit()], 1));
    const { type, advance, byId, texts } = await render(ON);
    await type('invoice');
    expect(mockSearch).not.toHaveBeenCalled();
    await advance();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0]).toMatchObject({ q: 'invoice', chatId: undefined });
    expect(byId('room-list-message-matches').length).toBeGreaterThan(0);
    expect(byId('message-search-hit-' + 'row1').length).toBeGreaterThan(0);
    expect(texts().some((s) => /1/.test(s))).toBe(true);
  });

  it('shows the empty note when neither chats nor messages match', async () => {
    mockSearch.mockResolvedValue(page([]));
    const { type, advance, byId } = await render(ON);
    await type('zzzz');
    await advance();
    expect(byId('room-list-message-empty').length).toBeGreaterThan(0);
  });

  it('Show more loads the next page and disables itself while loading', async () => {
    mockSearch.mockResolvedValueOnce(page([hit()], 2));
    const { type, advance, byId } = await render(ON);
    await type('invoice');
    await advance();
    let resolveMore!: (v: any) => void;
    mockSearch.mockReturnValueOnce(new Promise((r) => (resolveMore = r)));
    await act(async () => {
      byId('room-list-message-more')[0].props.onPress();
    });
    expect(byId('room-list-message-more')[0].props.disabled).toBe(true);
    expect(mockSearch.mock.calls[1][0].offset).toBe(1);
    await act(async () => {
      resolveMore(page([hit({ id: 'row2', body: 'invoice two' })], 2, 1));
      await Promise.resolve();
    });
    expect(byId('message-search-hit-row2').length).toBeGreaterThan(0);
    expect(byId('room-list-message-more')).toHaveLength(0);
  });

  it('shows an error with Retry', async () => {
    mockSearch.mockRejectedValueOnce(new Error('x'));
    const { type, advance, byId } = await render(ON);
    await type('invoice');
    await advance();
    expect(byId('room-list-message-error').length).toBeGreaterThan(0);
    mockSearch.mockResolvedValueOnce(page([hit()]));
    await act(async () => {
      byId('room-list-message-retry')[0].props.onPress();
      await Promise.resolve();
    });
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('a tap opens the hit room through the row path and requests the jump', async () => {
    mockSearch.mockResolvedValue(page([hit()]));
    const { type, advance, byId } = await render(ON);
    await type('invoice');
    await advance();
    await act(async () => {
      byId('message-search-hit-row1')[0].props.onPress();
    });
    expect(onRoomClick).toHaveBeenCalledWith(expect.objectContaining({ jid: TWO }));
    const st: any = store.getState().rooms;
    expect(st.activeRoomJID).toBe(TWO);
  });
});
