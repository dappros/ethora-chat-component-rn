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
