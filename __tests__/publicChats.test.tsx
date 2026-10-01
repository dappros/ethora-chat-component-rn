import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  addRoom,
  clearJoiningRoom,
  setCurrentRoom,
  setJoiningRoom,
} from '../src/roomStore/roomsSlice';
import { setActiveModal, setConfig } from '../src/roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../src/helpers/constants/MODAL_TYPES';

const mockGetPublicChats = jest.fn();
jest.mock('../src/networking/api-requests/publicChats.api', () => ({
  getPublicChats: (...a: unknown[]) => mockGetPublicChats(...a),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: null }),
}));

import PublicChatsModal from '../src/components/Modals/PublicChatsModal/PublicChatsModal';
import {
  filterPublicChats,
  publicChatJid,
} from '../src/components/Modals/PublicChatsModal/publicChatsLogic';
import { showsStandaloneDiscoverButton } from '../src/helpers/publicChatsEntry';
import { HeaderRoomList } from '../src/components/Header/HeaderRoomList';

const CONF = 'conference.xmpp.test';
const chat = (name: string, over: any = {}) => ({
  name,
  title: `Title ${name}`,
  description: `About ${name}`,
  picture: '',
  e2ee: false,
  ...over,
});
const page = (items: any[], total = items.length, nextOffset = items.length) => ({
  items,
  total,
  offset: 0,
  limit: 50,
  nextOffset,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <PublicChatsModal handleCloseModal={jest.fn()} />
      </Provider>
    );
  });
  await flush();
  const byId = (id: string) =>
    tree.root.findAll((n) => n.props?.testID === id && typeof n.type !== 'string');
  const press = async (id: string) => {
    await act(async () => {
      byId(id)[0].props.onPress();
    });
    await flush();
  };
  const type = async (id: string, text: string) => {
    await act(async () => {
      byId(id)[0].props.onChangeText(text);
    });
  };
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c) => typeof c === 'string') as string[];
  return { tree, byId, press, type, texts };
};

beforeEach(async () => {
  mockGetPublicChats.mockReset();
  await act(async () => {
    store.dispatch(setConfig({ xmppSettings: { conference: CONF } } as any));
    store.dispatch(setCurrentRoom({ roomJID: '' }));
    store.dispatch(setActiveModal(MODAL_TYPES.PUBLIC_CHATS));
    store.dispatch(
      addRoom({
        roomData: {
          id: 'x', jid: `joined@${CONF}`, name: 'joined', title: 'Joined',
          usersCnt: 1, messages: [], isLoading: false, roomBg: '',
        } as any,
      })
    );
  });
});

describe('publicChatsLogic', () => {
  it('filters on title and description of what has loaded', () => {
    const items = [chat('a', { title: 'Alpha' }), chat('b', { description: 'Hiking club' })];
    expect(filterPublicChats(items, ' alp ').map((c) => c.name)).toEqual(['a']);
    expect(filterPublicChats(items, 'HIKING').map((c) => c.name)).toEqual(['b']);
    expect(filterPublicChats(items, '')).toHaveLength(2);
  });

  it('builds the room JID from the conference domain, and refuses without one', () => {
    expect(publicChatJid({ name: 'room1' }, CONF)).toBe(`room1@${CONF}`);
    expect(publicChatJid({ name: 'room1' }, '  ')).toBeUndefined();
    expect(publicChatJid({ name: 'room1' }, undefined)).toBeUndefined();
  });
});

describe('PublicChatsModal', () => {
  it('shows a loader, then the chats with Join or Open depending on membership', async () => {
    let resolve!: (v: unknown) => void;
    mockGetPublicChats.mockReturnValue(new Promise((r) => (resolve = r)));
    const { byId, texts } = await render();
    expect(byId('public-chats-loading').length).toBeGreaterThan(0);
    await act(async () => {
      resolve(page([chat('fresh'), chat('joined')]));
    });
    await flush();
    expect(byId('public-chats-loading')).toHaveLength(0);
    const all = texts();
    expect(all).toContain('Title fresh');
    expect(all).toContain('Join');
    expect(all).toContain('Open');
  });

  it('joining selects `${name}@${conference}` and closes the screen', async () => {
    mockGetPublicChats.mockResolvedValue(page([chat('fresh')]));
    const { press } = await render();
    await press('public-chat-fresh');
    expect(store.getState().rooms.activeRoomJID).toBe(`fresh@${CONF}`);
    expect(store.getState().chatSettingStore.activeModal).toBeUndefined();
  });

  it('does nothing when there is no conference domain to build a JID from', async () => {
    await act(async () => {
      store.dispatch(setConfig({} as any));
    });
    mockGetPublicChats.mockResolvedValue(page([chat('fresh')]));
    const { press } = await render();
    await press('public-chat-fresh');
    expect(store.getState().rooms.activeRoomJID).toBe('');
  });

  it('filters locally and says to load more when nothing matches yet', async () => {
    mockGetPublicChats.mockResolvedValue(page([chat('a', { title: 'Alpha' })], 120, 50));
    const { type, byId, texts } = await render();
    await type('public-chats-filter', 'zzz');
    expect(texts()).toContain(
      'No match among the chats loaded so far. Show more to keep looking.'
    );
    expect(byId('public-chats-more').length).toBeGreaterThan(0);
    // No search parameter is ever sent: the endpoint rejects them.
    expect(Object.keys(mockGetPublicChats.mock.calls[0][0])).toEqual(['offset']);
  });

  it('pages by the server offset and does not repeat a chat', async () => {
    mockGetPublicChats
      .mockResolvedValueOnce(page([chat('a'), chat('b')], 4, 2))
      .mockResolvedValueOnce(page([chat('b'), chat('c')], 4, 4));
    const { press, texts } = await render();
    await press('public-chats-more');
    expect(mockGetPublicChats.mock.calls[1][0]).toEqual({ offset: 2 });
    expect(texts().filter((x) => x === 'Title b')).toHaveLength(1);
    expect(texts()).toContain('Title c');
  });

  it('shows an error with a retry', async () => {
    mockGetPublicChats.mockRejectedValueOnce(new Error('x'));
    const { byId, press } = await render();
    expect(byId('public-chats-error').length).toBeGreaterThan(0);
    mockGetPublicChats.mockResolvedValueOnce(page([chat('a')]));
    await press('public-chats-retry');
    expect(byId('public-chats-error')).toHaveLength(0);
  });
});

describe('stand-alone Discover button rule', () => {
  it('appears only when the host hides or overrides the menu', () => {
    expect(showsStandaloneDiscoverButton({} as any)).toBe(false);
    expect(showsStandaloneDiscoverButton({ headerMenu: true } as any)).toBe(false);
    expect(showsStandaloneDiscoverButton({ headerMenu: () => {} } as any)).toBe(true);
    expect(
      showsStandaloneDiscoverButton({ chatHeaderSettings: { disableMenu: true } } as any)
    ).toBe(true);
  });

  it('is removed by disableRoomMenu and by disablePublicChatsDirectory', () => {
    const host = { headerMenu: () => {} };
    expect(showsStandaloneDiscoverButton({ ...host, disableRoomMenu: true } as any)).toBe(false);
    expect(
      showsStandaloneDiscoverButton({ ...host, disablePublicChatsDirectory: true } as any)
    ).toBe(false);
  });

  const renderHeader = async (config: any) => {
    await act(async () => {
      store.dispatch(setConfig(config));
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <HeaderRoomList setDrawerOpen={jest.fn()} />
        </Provider>
      );
    });
    return tree.root.findAll((n) => n.props?.testID === 'room-list-discover');
  };

  it('the room list header shows the button for an overriding host and opens the directory', async () => {
    const found = await renderHeader({ headerMenu: () => {} });
    expect(found.length).toBeGreaterThan(0);
    await act(async () => {
      found.find((n) => typeof n.props.onPress === 'function')!.props.onPress();
    });
    expect(store.getState().chatSettingStore.activeModal).toBe(MODAL_TYPES.PUBLIC_CHATS);
  });

  it('the room list header has no button for a default host', async () => {
    expect(await renderHeader({})).toHaveLength(0);
  });
});

describe('joiningRoomJID', () => {
  it('only clears when it still names that room', () => {
    store.dispatch(setJoiningRoom(`a@${CONF}`));
    store.dispatch(clearJoiningRoom(`b@${CONF}`));
    expect(store.getState().rooms.joiningRoomJID).toBe(`a@${CONF}`);
    store.dispatch(clearJoiningRoom(`a@${CONF}`));
    expect(store.getState().rooms.joiningRoomJID).toBeNull();
  });
});

afterAll(() => new Promise((r) => setTimeout(r, 100)));
