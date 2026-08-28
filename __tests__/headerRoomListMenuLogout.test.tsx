import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Animated, TouchableOpacity } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import {
  HeaderRoomListMenu,
  runLogoutFlow,
} from '../src/components/Menu/HeaderRoomListMenu';
import { logoutService } from '../src/hooks/useLogout';

jest.mock('../src/hooks/useLogout', () => {
  const performLogout = jest.fn(() => Promise.resolve());
  return {
    logoutService: { performLogout },
    useLogout: () => performLogout,
  };
});

const performLogoutMock = logoutService.performLogout as jest.Mock;

const flush = () => new Promise((r) => setTimeout(r, 0));

const renderMenu = async (config: any) => {
  await act(async () => {
    store.dispatch(setConfig(config));
  });
  const closeDrawer = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <HeaderRoomListMenu
          isDrawerOpen
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
