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

const SEARCH_H = 64;
const LIST_H = 600;

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
  const list = () => tree.root.findByType(FlatList);
  const strip = () => tree.root.find((n) => n.props?.testID === 'room-list-search');

  /** Feed the measurements the component waits for before it can tuck the
   * search away: strip height, viewport height and content height. */
  const measure = async (contentH: number) => {
    await act(async () => {
      strip().props.onLayout({ nativeEvent: { layout: { height: SEARCH_H } } });
      list().props.onLayout({ nativeEvent: { layout: { height: LIST_H } } });
      list().props.onContentSizeChange(320, contentH);
    });
  };

  const scroll = async (handler: string, y: number) => {
    await act(async () => {
      list().props[handler]({ nativeEvent: { contentOffset: { y } } });
    });
  };

  return { tree, flatStyle, list, strip, measure, scroll };
};

describe('Room list search strip', () => {
  let scrollToOffset: jest.SpyInstance;

  beforeEach(() => {
    scrollToOffset = jest
      .spyOn(FlatList.prototype, 'scrollToOffset')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    scrollToOffset.mockRestore();
  });

  it('rides in the scrollable content as the list header, not pinned above it', async () => {
    const { list, strip, flatStyle } = await render();
    // The header element the list renders IS the search strip: dragging
    // the content down is what brings it back into view.
    expect(list().props.ListHeaderComponent.props.testID).toBe(
      'room-list-search'
    );
    const style = flatStyle(strip().props.style);
    expect(style.position).toBeUndefined();
    // No padding stand-in either — the header itself takes the space.
    expect(flatStyle(list().props.contentContainerStyle).paddingTop).toBe(
      undefined
    );
  });

  it('opens scrolled past the search, so only chats show at first', async () => {
    const { measure } = await render();
    await measure(2000);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: SEARCH_H,
      animated: false,
    });
  });

  it('leaves the search in view when there are too few chats to scroll it away', async () => {
    const { measure } = await render();
    await measure(LIST_H + SEARCH_H - 10);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('does not tuck the search away once the user has taken hold of the list', async () => {
    const { measure, scroll } = await render();
    await scroll('onScrollBeginDrag', 0);
    await measure(2000);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('magnets the half-shown search closed when the list settles past its middle', async () => {
    const { measure, scroll } = await render();
    await measure(2000);
    scrollToOffset.mockClear();
    await scroll('onMomentumScrollEnd', SEARCH_H * 0.7);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: SEARCH_H,
      animated: true,
    });
  });

  it('magnets it fully open when the list settles before its middle', async () => {
    const { measure, scroll } = await render();
    await measure(2000);
    scrollToOffset.mockClear();
    await scroll('onMomentumScrollEnd', SEARCH_H * 0.3);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('leaves a settled list alone at either end', async () => {
    const { measure, scroll } = await render();
    await measure(2000);
    scrollToOffset.mockClear();
    await scroll('onMomentumScrollEnd', 0);
    await scroll('onMomentumScrollEnd', SEARCH_H * 4);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('keeps the search open while it is being typed in', async () => {
    const { measure, scroll, strip } = await render();
    await measure(2000);
    await act(async () => {
      strip().props.children.props.onChangeText('on');
    });
    scrollToOffset.mockClear();
    // Past the middle, which would normally hide it.
    await scroll('onMomentumScrollEnd', SEARCH_H * 0.7);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('pulls the search fully into view when the field takes focus', async () => {
    const { measure, strip } = await render();
    await measure(2000);
    scrollToOffset.mockClear();
    await act(async () => {
      strip().props.children.props.onFocus();
    });
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  describe('release without momentum', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('snaps after the release settles', async () => {
      const { measure, scroll } = await render();
      await measure(2000);
      scrollToOffset.mockClear();
      await scroll('onScrollEndDrag', SEARCH_H * 0.7);
      expect(scrollToOffset).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: SEARCH_H,
        animated: true,
      });
    });

    it('yields to a flick instead of fighting its momentum', async () => {
      const { measure, scroll, list } = await render();
      await measure(2000);
      scrollToOffset.mockClear();
      await scroll('onScrollEndDrag', SEARCH_H * 0.7);
      await act(async () => {
        list().props.onMomentumScrollBegin();
        jest.advanceTimersByTime(100);
      });
      expect(scrollToOffset).not.toHaveBeenCalled();
    });
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
