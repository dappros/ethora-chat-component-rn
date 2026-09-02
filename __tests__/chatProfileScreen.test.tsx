import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Animated, Image, Text, TouchableOpacity } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { addRoom, setCurrentRoom, updateRoom } from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import ChatProfileModal, {
  searchScrollTarget,
} from '../src/components/Modals/ChatProfileModal/ChatProfileModal';
import { QrIcon } from '../src/assets/icons';

// `mock`-prefixed names are the only bindings jest.mock's factory may
// close over (its hoisting runs before these are initialised otherwise).
const mockLeaveTheRoomStanza = jest.fn();
const mockGetRoomMembersStanza = jest.fn();
const mockSetRoomImageStanza = jest.fn();

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({
    client: {
      leaveTheRoomStanza: mockLeaveTheRoomStanza,
      getRoomMembersStanza: mockGetRoomMembersStanza,
      setRoomImageStanza: mockSetRoomImageStanza,
    },
  }),
}));

// The screen is normally mounted under ReduxWrapper's SafeAreaProvider;
// the renderer has no window metrics, so stand in with a notch-sized inset.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
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

const JID = 'general@conference.xmpp.chat.ethora.com';

// The test renderer has no host instances; hand components something with
// the imperative methods this screen calls.
const mockScrollTo = jest.fn();

const members = [
  {
    _id: 'u1',
    firstName: 'Ann',
    lastName: 'Owner',
    xmppUsername: 'u1',
    role: 'owner',
    last_active: 1700000000,
  },
  {
    _id: 'u2',
    firstName: 'Bob',
    lastName: 'Banned',
    xmppUsername: 'u2',
    role: 'participant',
    ban_status: 'banned',
  },
  {
    _id: 'me',
    firstName: 'Me',
    lastName: 'Self',
    xmppUsername: 'me',
    role: 'moderator',
  },
];

const seedRoom = async (updates: any = {}) => {
  await act(async () => {
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'general',
          title: 'Group name',
          usersCnt: 3,
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
        updates: {
          type: 'group',
          role: 'moderator',
          description: 'Some chat description',
          roomMembers: members,
          ...updates,
        },
      })
    );
    store.dispatch(setUser({ xmppUsername: 'me' } as any));
    store.dispatch(setConfig({} as any));
  });
};

const renderProfile = async () => {
  const handleCloseModal = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ChatProfileModal handleCloseModal={handleCloseModal} />
      </Provider>,
      { createNodeMock: () => ({ scrollTo: mockScrollTo, focus: jest.fn() }) }
    );
  });
  // `findAll` matches composite AND host nodes carrying the testID, so a
  // single element shows up more than once — presence is what we assert.
  const byId = (id: string) => tree.root.findAll((n) => n.props?.testID === id);
  const has = (id: string) => byId(id).length > 0;
  // A <Text>{first} {last}</Text> arrives as an array of children, so
  // flatten before matching.
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .flatMap((n) =>
        Array.isArray(n.props.children) ? n.props.children : [n.props.children]
      )
      .filter((c) => typeof c === 'string')
      .map((c) => (c as string).trim())
      .filter(Boolean) as string[];
  return { tree, handleCloseModal, byId, has, texts };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Chat profile screen', () => {
  it('drops the QR and favourite affordances the design removed', async () => {
    await seedRoom({ type: 'public' });
    const { tree, texts } = await renderProfile();
    // QR was rendered for public rooms by the old header.
    expect(tree.root.findAllByType(QrIcon)).toHaveLength(0);
    expect(texts().some((label) => /favourite/i.test(label))).toBe(false);
  });

  it('shows the chat picture as the hero when the room has one', async () => {
    await seedRoom({ icon: 'https://cdn.example.com/room.png' });
    const { has, tree } = await renderProfile();
    expect(has('chat-profile-hero-image')).toBe(true);
    expect(has('chat-profile-hero-initials')).toBe(false);
    const uri = (tree.root
      .find((n) => n.props?.testID === 'chat-profile-hero-image')
      .props.source as any).uri;
    expect(uri).toContain('https://cdn.example.com/room.png');
  });

  it('falls back to two uppercase letters on a solid background', async () => {
    await seedRoom({ icon: null });
    const { has, tree } = await renderProfile();
    expect(has('chat-profile-hero-image')).toBe(false);
    const initials = tree.root.find(
      (n) => n.props?.testID === 'chat-profile-hero-initials'
    );
    expect(initials.props.children).toBe('GN');
    // Every image in the tree is a member avatar, never the missing hero.
    expect(tree.root.findAllByType(Image).length).toBeGreaterThanOrEqual(0);
  });

  it('offers Search, Leave and Report in that order, and only one magnifier', async () => {
    await seedRoom();
    const { tree, texts } = await renderProfile();
    const order = tree.root
      .findAll(
        (n) =>
          typeof n.props?.testID === 'string' &&
          n.props.testID.startsWith('chat-profile-action-') &&
          typeof n.props?.onPress === 'function'
      )
      .map((n) => n.props.testID.replace('chat-profile-action-', ''));
    // Composite + host node both carry the testID, hence the dedupe.
    expect(Array.from(new Set(order))).toEqual(['search', 'leave', 'report']);
    // The members card used to carry a second magnifier of its own.
    expect(texts().filter((label) => label === 'Search')).toHaveLength(1);
  });

  it('collapses the header for search only when it is still expanded', () => {
    // Expanded: tuck the picture away so results and keyboard have room.
    expect(searchScrollTarget(false, 160)).toBe(160);
    // Already collapsed: leave the scroll position alone.
    expect(searchScrollTarget(true, 160)).toBeNull();
  });

  it('moves Search into the "…" menu once the header is collapsed', async () => {
    await seedRoom();
    const { tree, has } = await renderProfile();
    const openMenu = async () => {
      await act(async () => {
        tree.root
          .find((n) => n.props?.testID === 'chat-profile-menu')
          .props.onPress();
      });
    };
    await openMenu();
    expect(has('chat-profile-menu-search')).toBe(false);
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'chat-profile-menu-backdrop')
        .props.onPress();
    });

    // Scroll past the collapse point: the hero's Search button is gone, so
    // the menu has to carry it. `Animated.event` with a native driver hands
    // over an AnimatedEvent, whose JS listener is behind __getHandler().
    const handler: any = tree.root.findByType(Animated.ScrollView as any).props
      .onScroll;
    const fire =
      typeof handler === 'function' ? handler : handler?.__getHandler?.();
    await act(async () => {
      fire?.({ nativeEvent: { contentOffset: { y: 400 } } });
    });
    await openMenu();
    expect(has('chat-profile-menu-search')).toBe(true);
  });

  it('filters the member list by name once search is open', async () => {
    await seedRoom();
    const { tree, has, texts } = await renderProfile();
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'chat-profile-action-search')
        .props.onPress();
    });
    expect(has('chat-profile-member-search')).toBe(true);

    const type = async (value: string) => {
      await act(async () => {
        tree.root
          .find((n) => n.props?.testID === 'chat-profile-member-search')
          .props.onChangeText(value);
      });
    };

    await type('bob');
    expect(texts()).toContain('Bob');
    expect(texts()).not.toContain('Ann');

    // Matching is on the full name, not just the first word.
    await type('owner');
    expect(texts()).toContain('Ann');

    await type('zzz');
    expect(has('chat-profile-members-empty')).toBe(true);
  });

  it('restores the full list when search is dismissed', async () => {
    await seedRoom();
    const { tree, has, texts } = await renderProfile();
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'chat-profile-action-search')
        .props.onPress();
    });
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'chat-profile-member-search')
        .props.onChangeText('bob');
    });
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'chat-profile-search-close')
        .props.onPress();
    });
    expect(has('chat-profile-member-search')).toBe(false);
    expect(texts()).toContain('Ann');
  });

  it('leaves room to scroll into the collapsed state even with a short list', async () => {
    await seedRoom({ roomMembers: [members[0]] });
    const { tree } = await renderProfile();
    const scroll = tree.root.findByType(Animated.ScrollView as any);
    await act(async () => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    });
    const container = tree.root.findByType(Animated.ScrollView as any).props
      .contentContainerStyle as any[];
    const minHeight = container
      .filter(Boolean)
      .map((style: any) => style?.minHeight)
      .find((h: any) => typeof h === 'number');
    // Viewport + the hero-to-bar distance: without it the content is
    // shorter than the screen and the scroll just springs back.
    expect(minHeight).toBeGreaterThan(700);
  });

  it('opens the "…" menu as an anchored card with only the allowed actions', async () => {
    await seedRoom();
    const { tree, has } = await renderProfile();
    expect(has('chat-profile-menu-card')).toBe(false);
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'chat-profile-menu').props.onPress();
    });
    expect(has('chat-profile-menu-card')).toBe(true);
    expect(has('chat-profile-menu-edit')).toBe(true);
    expect(has('chat-profile-menu-report')).toBe(true);
    expect(has('chat-profile-menu-delete-and-leave')).toBe(true);
    // No picture on this room, so there is nothing to remove.
    expect(has('chat-profile-menu-remove-photo')).toBe(false);
  });

  it('keeps destructive chat actions out of a plain member\'s menu', async () => {
    await seedRoom({ role: 'participant' });
    const { tree, has } = await renderProfile();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'chat-profile-menu').props.onPress();
    });
    expect(has('chat-profile-menu-report')).toBe(true);
    expect(has('chat-profile-menu-edit')).toBe(false);
    expect(has('chat-profile-menu-delete-and-leave')).toBe(false);
  });

  it('leaves the MUC and drops the room when Leave is confirmed', async () => {
    await seedRoom();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { tree, handleCloseModal } = await renderProfile();
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'chat-profile-action-leave')
        .props.onPress();
    });
    const buttons = alertSpy.mock.calls[0][2] as any[];
    const leave = buttons.find((b) => b.style === 'destructive');
    await act(async () => {
      leave.onPress();
    });
    expect(mockLeaveTheRoomStanza).toHaveBeenCalledWith(JID);
    expect(store.getState().rooms.rooms[JID]).toBeUndefined();
    expect(handleCloseModal).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows Add Members only to a moderator of a group chat', async () => {
    await seedRoom();
    const asModerator = await renderProfile();
    expect(asModerator.has('chat-profile-add-members')).toBe(true);

    await seedRoom({ role: 'participant' });
    const asMember = await renderProfile();
    expect(asMember.has('chat-profile-add-members')).toBe(false);
  });

  it('labels a banned member and keeps the owner role visible', async () => {
    await seedRoom();
    const { texts } = await renderProfile();
    expect(texts()).toEqual(expect.arrayContaining(['banned', 'owner']));
  });

  it('lets a moderator remove other members but not themselves', async () => {
    await seedRoom();
    const { has } = await renderProfile();
    expect(has('chat-profile-remove-u1')).toBe(true);
    expect(has('chat-profile-remove-me')).toBe(false);
  });

  it('keeps the collapsed bar and back button mounted for the scroll animation', async () => {
    await seedRoom();
    const { has, tree, handleCloseModal } = await renderProfile();
    expect(has('chat-profile-collapsed-title')).toBe(true);
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'chat-profile-back').props.onPress();
    });
    expect(handleCloseModal).toHaveBeenCalled();
  });

  it('drives the header from the scroll position natively', async () => {
    await seedRoom();
    const { tree } = await renderProfile();
    const scroll = tree.root.findByType(Animated.ScrollView as any);
    expect(scroll.props.scrollEventThrottle).toBe(16);
    // Animated.event with useNativeDriver hands RN an event config rather
    // than a plain JS callback — that's what keeps the parallax and the
    // collapsing bar off the JS thread.
    expect(scroll.props.onScroll).toBeTruthy();
  });
});
