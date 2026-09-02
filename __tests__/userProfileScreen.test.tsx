import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated, Share, Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig, setSelectedUser, setUser } from '../src/roomStore/chatSettingsSlice';
import UserProfileModal, {
  profileTabs,
  userInitials,
} from '../src/components/Modals/UserProfileModal/UserProfileModal';
import { getUserFiles, isMediaFile } from '../src/networking/api-requests/user.api';
import { LANGUAGE_OPTIONS } from '../src/helpers/constants/LANGUAGE_OPTIONS';

jest.mock('../src/networking/api-requests/user.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/user.api'),
  getUserFiles: jest.fn(async () => []),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: {} }),
}));

jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const getUserFilesMock = getUserFiles as jest.Mock;

const FILES = [
  { id: 'i1', name: 'photo.jpg', url: 'https://cdn/photo.jpg', mimetype: 'image/jpeg' },
  { id: 'v1', name: 'clip.mp4', url: 'https://cdn/clip.mp4', mimetype: 'video/mp4' },
  {
    id: 'd1',
    name: 'contract.pdf',
    url: 'https://cdn/contract.pdf',
    mimetype: 'application/pdf',
    createdAt: '2026-01-17T10:00:00.000Z',
  },
];

const seed = async (selected?: any) => {
  await act(async () => {
    store.dispatch(
      setUser({
        firstName: 'Ann',
        lastName: 'Owner',
        description: 'Some long description',
        xmppUsername: 'me',
        token: 'jwt',
      } as any)
    );
    store.dispatch(setSelectedUser(selected));
    store.dispatch(setConfig({ translates: { enabled: true } } as any));
  });
};

const render = async () => {
  const handleCloseModal = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <UserProfileModal handleCloseModal={handleCloseModal} />
      </Provider>,
      { createNodeMock: () => ({ scrollTo: jest.fn(), focus: jest.fn() }) }
    );
  });
  const has = (id: string) =>
    tree.root.findAll((n) => n.props?.testID === id).length > 0;
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .flatMap((n) =>
        Array.isArray(n.props.children) ? n.props.children : [n.props.children]
      )
      .filter((c) => typeof c === 'string')
      .map((c) => (c as string).trim())
      .filter(Boolean) as string[];
  return { tree, handleCloseModal, has, texts };
};

beforeEach(() => {
  jest.clearAllMocks();
  getUserFilesMock.mockResolvedValue([]);
});

describe('User profile screen', () => {
  it('sorts files into media and documents by mime type, then by extension', () => {
    expect(isMediaFile(FILES[0] as any)).toBe(true);
    expect(isMediaFile(FILES[1] as any)).toBe(true);
    expect(isMediaFile(FILES[2] as any)).toBe(false);
    // Deployments that store no mimetype still name the file.
    expect(isMediaFile({ id: 'x', name: 'a.HEIC', url: 'u', mimetype: '' })).toBe(true);
    expect(isMediaFile({ id: 'x', name: 'a.docx', url: 'u', mimetype: '' })).toBe(false);
  });

  it('only gives tabs to your own profile, and only for lists that exist', () => {
    const own = { isOwnProfile: true, translatesEnabled: true };
    expect(profileTabs({ ...own, hasMedia: true, hasDocuments: true })).toEqual([
      'language',
      'media',
      'documents',
    ]);
    expect(profileTabs({ ...own, hasMedia: false, hasDocuments: false })).toEqual([
      'language',
    ]);
    expect(
      profileTabs({ ...own, translatesEnabled: false, hasMedia: true, hasDocuments: false })
    ).toEqual(['media']);
    // /v2/files is scoped to the JWT owner, so another user's page has nothing.
    expect(
      profileTabs({
        isOwnProfile: false,
        translatesEnabled: true,
        hasMedia: true,
        hasDocuments: true,
      })
    ).toEqual([]);
  });

  it('builds initials from a name that starts with a digit', () => {
    expect(userInitials('Ann Owner')).toBe('AO');
    expect(userInitials('2Test 2User')).toBe('22');
  });

  it('own profile: Account, Share, Edit and Log out in the row, plus Leave', async () => {
    await seed(undefined);
    const { tree, has } = await render();
    const order = tree.root
      .findAll(
        (n) =>
          typeof n.props?.testID === 'string' &&
          n.props.testID.startsWith('user-profile-action-') &&
          typeof n.props?.onPress === 'function'
      )
      .map((n) => n.props.testID.replace('user-profile-action-', ''));
    expect(Array.from(new Set(order))).toEqual([
      'account',
      'share',
      'edit',
      'logout',
    ]);
    expect(has('user-profile-action-message')).toBe(false);
    // Leave sits at the right end of the name row.
    expect(has('user-profile-logout')).toBe(true);
    // Everything moved out of the overflow menu, so there is no "…" left.
    expect(has('user-profile-menu')).toBe(false);
  });

  it('opens the edit form from the action row', async () => {
    await seed(undefined);
    const { tree, has } = await render();
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'user-profile-action-edit')
        .props.onPress();
    });
    // The hero is replaced by the edit form.
    expect(has('user-profile-action-account')).toBe(false);
  });

  it("another user's profile: Message + Share, no Leave and no tabs", async () => {
    await seed({ id: 'u2', name: 'Bob Banned', userJID: 'u2' });
    const { has } = await render();
    expect(has('user-profile-action-message')).toBe(true);
    expect(has('user-profile-action-share')).toBe(true);
    expect(has('user-profile-action-account')).toBe(false);
    expect(has('user-profile-action-edit')).toBe(false);
    expect(has('user-profile-action-logout')).toBe(false);
    expect(has('user-profile-logout')).toBe(false);
    expect(has('user-profile-tab-language')).toBe(false);
    // …and it never asks for files that belong to the signed-in user.
    expect(getUserFilesMock).not.toHaveBeenCalled();
  });

  it('shows About with the description, falling back when there is none', async () => {
    await seed(undefined);
    const withText = await render();
    expect(withText.texts()).toContain('Some long description');

    await act(async () => {
      store.dispatch(setUser({ firstName: 'Ann', lastName: 'Owner', token: 'jwt' } as any));
    });
    const without = await render();
    expect(without.texts()).toContain('No description');
  });

  it('loads /v2/files once and splits it across the Media and Documents tabs', async () => {
    getUserFilesMock.mockResolvedValue(FILES);
    await seed(undefined);
    const { has, tree } = await render();
    expect(getUserFilesMock).toHaveBeenCalledTimes(1);
    expect(has('user-profile-tab-language')).toBe(true);
    expect(has('user-profile-tab-media')).toBe(true);
    expect(has('user-profile-tab-documents')).toBe(true);

    // Language is the first tab, so its list is what renders initially.
    expect(has(`user-profile-language-${LANGUAGE_OPTIONS[0].id}`)).toBe(true);

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'user-profile-tab-media').props.onPress();
    });
    expect(has('user-profile-media-i1')).toBe(true);
    expect(has('user-profile-media-v1')).toBe(true);
    expect(has('user-profile-document-d1')).toBe(false);

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'user-profile-tab-documents').props.onPress();
    });
    expect(has('user-profile-document-d1')).toBe(true);
    expect(has('user-profile-media-i1')).toBe(false);
  });

  it('changes the language from the Language tab', async () => {
    await seed(undefined);
    const { tree } = await render();
    const option = tree.root.findAll((n) =>
      typeof n.props?.testID === 'string' &&
      n.props.testID.startsWith('user-profile-language-')
    )[0];
    await act(async () => {
      option.props.onPress();
    });
    expect(store.getState().chatSettingStore.langSource).toBeTruthy();
  });

  it('shares the name and id through the system sheet', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({} as any);
    await seed({ id: 'u2', name: 'Bob Banned', userJID: 'bob@jid' });
    const { tree } = await render();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'user-profile-action-share').props.onPress();
    });
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('bob@jid') })
    );
    shareSpy.mockRestore();
  });

  it('keeps the collapsing header wired to the scroll position', async () => {
    await seed(undefined);
    const { tree, has } = await render();
    expect(has('user-profile-collapsed-title')).toBe(true);
    const scroll = tree.root.findByType(Animated.ScrollView as any);
    expect(scroll.props.scrollEventThrottle).toBe(16);
    expect(scroll.props.onScroll).toBeTruthy();
  });
});
