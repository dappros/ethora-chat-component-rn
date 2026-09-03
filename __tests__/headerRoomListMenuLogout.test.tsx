import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Animated, Modal, TouchableOpacity } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import {
  HeaderRoomListMenu,
  runLogoutFlow,
} from '../src/components/Menu/HeaderRoomListMenu';
import { logoutService } from '../src/hooks/useLogout';
import {
  shouldClaimVerticalDrag,
  shouldDismissOnDrag,
} from '../src/helpers/sheetGestures';

// The menu is a bottom sheet now, so it reads the bottom inset. The SDK
// mounts SafeAreaProvider in ReduxWrapper; the renderer has no window
// metrics, so stand one in.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('../src/hooks/useLogout', () => {
  const performLogout = jest.fn(() => Promise.resolve());
  return {
    logoutService: { performLogout },
    useLogout: () => performLogout,
  };
});

const performLogoutMock = logoutService.performLogout as jest.Mock;

const flush = () => new Promise((r) => setTimeout(r, 0));

const renderMenu = async (config: any, opts: { isDrawerOpen?: boolean } = {}) => {
  await act(async () => {
    store.dispatch(setConfig(config));
  });
  const closeDrawer = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <HeaderRoomListMenu
          isDrawerOpen={opts.isDrawerOpen ?? true}
          drawerAnimation={new Animated.Value(1)}
          overlayAnimation={new Animated.Value(1)}
          closeDrawer={closeDrawer}
        />
      </Provider>
    );
  });
  const labels = () =>
    tree.root
      .findAllByType(TouchableOpacity)
      .filter((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('header-menu-'))
      .map((n) => n.props.testID.replace('header-menu-', ''));
  const press = async (label: string) => {
    const node = tree.root
      .findAllByType(TouchableOpacity)
      .find((n) => n.props?.testID === `header-menu-${label}`)!;
    await act(async () => {
      node.props.onPress();
      await flush();
      await flush();
    });
  };
  return { tree, closeDrawer, labels, press };
};

const stubAlert = (choice: 'confirm' | 'cancel') =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const btn = choice === 'confirm' ? buttons?.[1] : buttons?.[0];
    btn?.onPress?.();
  });

beforeEach(() => {
  performLogoutMock.mockClear();
  jest.restoreAllMocks();
});

describe('HeaderRoomListMenu — bottom sheet', () => {
  it('slides up from the bottom instead of in from the right', async () => {
    const { tree } = await renderMenu({});
    const sheet = tree.root.find((n) => n.props?.testID === 'header-menu-sheet');
    const style = (Array.isArray(sheet.props.style)
      ? sheet.props.style
      : [sheet.props.style]
    ).flat();
    const flat = Object.assign({}, ...style.filter(Boolean));
    // Hugs the bottom edge, inset by a couple of points so the dimmed
    // screen shows around it, and only as tall as its rows.
    expect(flat.bottom).toBeLessThanOrEqual(4);
    expect(flat.left).toBeGreaterThan(0);
    expect(flat.right).toBeGreaterThan(0);
    expect(flat.top).toBeUndefined();
    expect(flat.height).toBeUndefined();
    expect(flat.borderRadius).toBeGreaterThan(0);
    // The motion is vertical now.
    const transform = flat.transform ?? [];
    expect(transform.some((t: any) => 'translateY' in t)).toBe(true);
    expect(transform.some((t: any) => 'translateX' in t)).toBe(false);
  });

  it('is not mounted at all while closed, so nothing bleeds along the edge', async () => {
    const { tree } = await renderMenu({}, { isDrawerOpen: false });
    expect(
      tree.root.findAll((n) => n.props?.testID === 'header-menu-sheet')
    ).toHaveLength(0);
  });

  it('presents through a real Modal so it reaches the screen edges', async () => {
    const { tree } = await renderMenu({});
    const modal = tree.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    // Without this the sheet is clipped by the room list's own container
    // and the dim stops short of the host's chrome.
    expect(modal.props.statusBarTranslucent).toBe(true);
  });

  it('has a grab area that claims the drag on touch-down', async () => {
    const { tree } = await renderMenu({});
    const grab = tree.root.find(
      (n) => n.props?.testID === 'header-menu-grabber'
    );
    expect(grab.props.onStartShouldSetResponder()).toBe(true);
    expect(typeof grab.props.onResponderRelease).toBe('function');
  });

  it('stacks the open and drag transforms instead of adding them', async () => {
    const { tree } = await renderMenu({});
    const sheet = tree.root.find((n) => n.props?.testID === 'header-menu-sheet');
    const style = (Array.isArray(sheet.props.style)
      ? sheet.props.style
      : [sheet.props.style]
    ).flat();
    const flat = Object.assign({}, ...style.filter(Boolean));
    // The parent's value runs on the native driver; mixing it into one
    // Animated.add expression with the JS-written drag value is what
    // silently froze the sheet.
    expect(flat.transform).toHaveLength(2);
    expect(flat.transform.every((t: any) => 'translateY' in t)).toBe(true);
  });

  it('can be pulled down to dismiss, without stealing row taps', async () => {
    const { tree } = await renderMenu({});
    const sheet = tree.root.find((n) => n.props?.testID === 'header-menu-sheet');
    // Pan handlers are attached…
    expect(typeof sheet.props.onResponderRelease).toBe('function');
    // …and only claim a clear downward pull, so a tap still hits the row.
    expect(sheet.props.onStartShouldSetResponder()).toBe(false);
    // Captured from the rows: without this the sheet could only be dragged
    // by the blank points between them.
    const capture = sheet.props.onMoveShouldSetResponderCapture;
    expect(typeof capture).toBe('function');
    expect(shouldClaimVerticalDrag(30, 0)).toBe(true);
    expect(shouldClaimVerticalDrag(3, 0)).toBe(false);
    expect(shouldDismissOnDrag(120, 0)).toBe(true);
    expect(shouldDismissOnDrag(30, 0.2)).toBe(false);
  });
});

describe('HeaderRoomListMenu — Sign out item visibility', () => {
  it('is absent when config.logout is missing', async () => {
    const { labels } = await renderMenu({});
    expect(labels()).toEqual(['New Chat', 'Profile', 'Settings']);
  });

  it('is absent when logout.enabled is false', async () => {
    const { labels } = await renderMenu({ logout: { enabled: false } });
    expect(labels()).toEqual(['New Chat', 'Profile', 'Settings']);
  });

  it('renders last with the default label when enabled', async () => {
    const { labels } = await renderMenu({ logout: { enabled: true } });
    expect(labels()).toEqual(['New Chat', 'Profile', 'Settings', 'Sign out']);
  });

  it('honours a custom label', async () => {
    const { labels } = await renderMenu({ logout: { enabled: true, label: 'Log out' } });
    expect(labels()[3]).toBe('Log out');
  });
});

describe('HeaderRoomListMenu — Sign out tap flow', () => {
  it('closes the drawer, then runs onBeforeLogout → performLogout → onAfterLogout', async () => {
    stubAlert('confirm');
    const order: string[] = [];
    const onBeforeLogout = jest.fn(async () => {
      order.push('before');
    });
    const onAfterLogout = jest.fn(async () => {
      order.push('after');
    });
    performLogoutMock.mockImplementation(async () => {
      order.push('perform');
    });
    const { closeDrawer, press } = await renderMenu({
      logout: { enabled: true, onBeforeLogout, onAfterLogout },
    });
    await press('Sign out');
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['before', 'perform', 'after']);
  });

  it('onBeforeLogout returning false cancels the teardown', async () => {
    stubAlert('confirm');
    const onAfterLogout = jest.fn();
    const { press } = await renderMenu({
      logout: { enabled: true, onBeforeLogout: () => false, onAfterLogout },
    });
    await press('Sign out');
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(onAfterLogout).not.toHaveBeenCalled();
  });

  it('cancelling the confirm dialog does nothing', async () => {
    stubAlert('cancel');
    const onBeforeLogout = jest.fn();
    const { press } = await renderMenu({ logout: { enabled: true, onBeforeLogout } });
    await press('Sign out');
    expect(onBeforeLogout).not.toHaveBeenCalled();
    expect(performLogoutMock).not.toHaveBeenCalled();
  });

  it('confirm: false skips the dialog entirely', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { press } = await renderMenu({ logout: { enabled: true, confirm: false } });
    await press('Sign out');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(performLogoutMock).toHaveBeenCalledTimes(1);
  });

  it('uses the custom confirm copy', async () => {
    const alertSpy = stubAlert('confirm');
    const { press } = await renderMenu({
      logout: {
        enabled: true,
        confirm: { title: 'T', message: 'M', confirmText: 'Yes', cancelText: 'No' },
      },
    });
    await press('Sign out');
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('T');
    expect(message).toBe('M');
    expect(buttons?.map((b) => b.text)).toEqual(['No', 'Yes']);
  });
});

describe('runLogoutFlow — host callback errors', () => {
  it('a throwing onBeforeLogout cancels and is logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await runLogoutFlow(
      {
        enabled: true,
        confirm: false,
        onBeforeLogout: () => {
          throw new Error('boom');
        },
      },
      performLogoutMock
    );
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('a throwing onAfterLogout is logged, not rethrown', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      runLogoutFlow(
        {
          enabled: true,
          confirm: false,
          onAfterLogout: async () => {
            throw new Error('nav failed');
          },
        },
        performLogoutMock
      )
    ).resolves.toBeUndefined();
    expect(performLogoutMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});
