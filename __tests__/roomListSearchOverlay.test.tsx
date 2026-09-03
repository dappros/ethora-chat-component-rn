import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import RoomList from '../src/components/MainComponents/RoomList';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: {} }),
}));

const CHATS = [
  {
    jid: 'one@conference.x',
    name: 'one',
    title: 'One',
    usersCnt: 2,
    messages: [],
    isLoading: false,
    roomBg: '',
  },
  {
    jid: 'two@conference.x',
    name: 'two',
    title: 'Two',
    usersCnt: 3,
    messages: [],
    isLoading: false,
    roomBg: '',
  },
];

const render = async () => {
  await act(async () => {
    store.dispatch(setUser({ firstName: 'Ann', token: 'jwt' } as any));
    store.dispatch(setConfig({} as any));
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <RoomList chats={CHATS as any} onRoomClick={jest.fn()} />
      </Provider>
    );
  });
  const flatStyle = (style: any) =>
    Object.assign(
      {},
      ...(Array.isArray(style) ? style : [style]).flat().filter(Boolean)
    );
  return { tree, flatStyle };
};

describe('Room list search strip', () => {
  it('floats over the list on a transparent strip', async () => {
    const { tree, flatStyle } = await render();
    const strip = tree.root.find((n) => n.props?.testID === 'room-list-search');
    const style = flatStyle(strip.props.style);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(0);
    // Transparent, so the rooms passing underneath stay visible around the
    // field's own white card.
    expect(style.backgroundColor).toBe('transparent');
  });

  it('pads the list so the first room clears the field, then scrolls under it', async () => {
    const { tree, flatStyle } = await render();
    const list = tree.root.findByType(FlatList);
    const padding = flatStyle(list.props.contentContainerStyle).paddingTop;
    expect(padding).toBeGreaterThan(0);

    // The strip reports its real height; the padding follows it.
    const strip = tree.root.find((n) => n.props?.testID === 'room-list-search');
    await act(async () => {
      strip.props.onLayout({ nativeEvent: { layout: { height: 72 } } });
    });
    const updated = tree.root.findByType(FlatList);
    expect(flatStyle(updated.props.contentContainerStyle).paddingTop).toBe(72);
  });
});

describe('Room list header burger', () => {
  const renderWith = async (cfg: any) => {
    await act(async () => {
      store.dispatch(setUser({ firstName: 'Ann', token: 'jwt' } as any));
      store.dispatch(setConfig(cfg));
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <RoomList chats={CHATS as any} onRoomClick={jest.fn()} />
        </Provider>
      );
    });
    const has = (id: string) =>
      tree.root.findAll((n) => n.props?.testID === id).length > 0;
    return { tree, has };
  };

  it('is hidden unless the host asks for it', async () => {
    const { has } = await renderWith({});
    expect(has('room-list-burger')).toBe(false);
  });

  it('shows and opens the SDK menu when headerMenu is true', async () => {
    const { tree, has } = await renderWith({ headerMenu: true });
    expect(has('room-list-burger')).toBe(true);
    expect(has('header-menu-sheet')).toBe(false);
    await act(async () => {
      tree.root
        .find(
          (n) =>
            n.props?.testID === 'room-list-burger' &&
            typeof n.props?.onPress === 'function'
        )
        .props.onPress();
    });
    expect(has('header-menu-sheet')).toBe(true);
  });

  it('calls the host handler when headerMenu is a function', async () => {
    const headerMenu = jest.fn();
    const { tree, has } = await renderWith({ headerMenu });
    await act(async () => {
      tree.root
        .find(
          (n) =>
            n.props?.testID === 'room-list-burger' &&
            typeof n.props?.onPress === 'function'
        )
        .props.onPress();
    });
    expect(headerMenu).toHaveBeenCalled();
    // The host drives its own drawer, so the SDK's sheet stays closed.
    expect(has('header-menu-sheet')).toBe(false);
  });

  it('stays hidden when disableRoomMenu is set', async () => {
    const { has } = await renderWith({ headerMenu: true, disableRoomMenu: true });
    expect(has('room-list-burger')).toBe(false);
  });
});
