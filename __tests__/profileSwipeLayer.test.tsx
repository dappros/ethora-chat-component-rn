import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { store, RootState } from '../src/roomStore';
import { addRoom, setCurrentRoom } from '../src/roomStore/roomsSlice';
import {
  setActiveModal,
  setConfig,
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import Modal from '../src/components/Modals/Modal/Modal';
import { MODAL_TYPES } from '../src/helpers/constants/MODAL_TYPES';

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({
    client: { getRoomMembersStanza: jest.fn(), leaveTheRoomStanza: jest.fn() },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('react-native-gesture-handler', () => {
  const chain: any = new Proxy({}, { get: () => () => chain });
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: any) => children,
  };
});
// Only the screen under test: the full registry pulls in every modal and
// their native dependencies.
jest.mock('../src/helpers/constants/MODAL_COMPONENTS', () => ({
  MODAL_COMPONENTS: {
    chatprofile:
      require('../src/components/Modals/ChatProfileModal/ChatProfileModal')
        .default,
  },
}));

const JID = 'general@conference.xmpp.chat.ethora.com';

// The modal host exactly as ChatWrapper mounts it.
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

describe('profile swipe-back layer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens, closes with the back button, and opens again', async () => {
    await act(async () => {
      store.dispatch(
        addRoom({
          roomData: {
            id: '1',
            jid: JID,
            name: 'general',
            title: 'Group name',
            usersCnt: 1,
            messages: [],
            isLoading: false,
            roomBg: '',
          },
        } as any)
      );
      store.dispatch(setCurrentRoom({ roomJID: JID }));
      store.dispatch(setUser({ xmppUsername: 'me' } as any));
      store.dispatch(setConfig({} as any));
    });

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <Host />
        </Provider>
      );
    });
    const back = () => tree!.root.findAllByProps({ testID: 'chat-profile-back' });

    for (let round = 0; round < 3; round++) {
      await act(async () => {
        store.dispatch(setActiveModal(MODAL_TYPES.CHAT_PROFILE as any));
      });
      expect(modalInStore()).toBe(MODAL_TYPES.CHAT_PROFILE);
      expect(back().length).toBeGreaterThan(0);

      await act(async () => {
        back()[0].props.onPress();
        // The page slides out first; the modal closes when it has left.
        jest.advanceTimersByTime(1000);
      });
      expect(modalInStore()).toBeUndefined();
      expect(back().length).toBe(0);
    }
  });
});
