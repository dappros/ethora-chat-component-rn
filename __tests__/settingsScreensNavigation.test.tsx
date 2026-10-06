/**
 * Screens under Settings (Change password here) are pages: their back
 * button and the left-edge swipe return to Settings, not to the chat list.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { store, RootState } from '../src/roomStore';
import {
  setActiveModal,
  setConfig,
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import Modal from '../src/components/Modals/Modal/Modal';
import { SwipeBackLayer } from '../src/components/Modals/Modal/SwipeBackLayer';
import { MODAL_TYPES } from '../src/helpers/constants/MODAL_TYPES';

jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() },
  getCurrentBaseURL: () => '',
  normalizeApiPath: (path?: string) => path,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('react-native-gesture-handler', () => {
  const chain: any = new Proxy({}, { get: () => () => chain });
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: any) => children,
  };
});
// Only the screens under test: the full registry pulls in every modal.
jest.mock('../src/helpers/constants/MODAL_COMPONENTS', () => ({
  MODAL_COMPONENTS: {
    change_password:
      require('../src/components/Modals/SettingsModals/ChangePassword/ChangePasswordModal')
        .default,
    settings: () => {
      const { Text } = require('react-native');
      return <Text testID="settings-screen">Settings</Text>;
    },
  },
}));

const Host = () => {
  const dispatch = useDispatch();
  const activeModal = useSelector(
    (state: RootState) => state.chatSettingStore.activeModal
  );
  return (
    <Modal
      modal={activeModal}
      setOpenModal={(value?: any) => dispatch(setActiveModal(value))}
    />
  );
};

const modalInStore = () => store.getState().chatSettingStore.activeModal;

describe('change password screen navigation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('slides in as a page and goes back to Settings, not to the chat list', async () => {
    await act(async () => {
      store.dispatch(setUser({ xmppUsername: 'me', token: 't' } as any));
      store.dispatch(setConfig({ settings: { changePassword: true } } as any));
      store.dispatch(setActiveModal(MODAL_TYPES.CHANGE_PASSWORD as any));
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <Host />
        </Provider>
      );
    });

    // A page with the edge-swipe layer, not a dialog on the shared backdrop.
    expect(tree.root.findAllByType(SwipeBackLayer).length).toBe(1);
    expect(tree.root.findAllByProps({ testID: 'password-current' }).length).toBeGreaterThan(0);
    // Settings is already underneath, so the slide out reveals it - not the
    // chat list - and nothing flashes once the page has gone.
    expect(tree.root.findAllByProps({ testID: 'settings-screen' }).length).toBeGreaterThan(0);

    // The header's back button: the screen slides out, then Settings is up.
    const back = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props.EndIcon !== undefined
    )[0];
    await act(async () => {
      back.props.onPress();
      jest.advanceTimersByTime(1000);
    });
    expect(modalInStore()).toBe(MODAL_TYPES.SETTINGS);
    expect(tree.root.findAllByProps({ testID: 'settings-screen' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'password-current' }).length).toBe(0);

    await act(async () => {
      store.dispatch(setActiveModal(undefined));
      tree.unmount();
    });
  });
});
