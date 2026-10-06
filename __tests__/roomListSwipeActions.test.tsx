/**
 * A room-list row swiped to the left shows Report and Leave behind it.
 * Leave asks first, then sends the unavailable presence and drops the room;
 * Report opens the report form for that room. `disableRoomSwipeActions`
 * turns the whole thing off.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { addRoom } from '../src/roomStore/roomsSlice';
import RoomList from '../src/components/MainComponents/RoomList';
import { ToastProvider } from '../src/context/ToastContext';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const mockLeaveTheRoomStanza = jest.fn();
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: { leaveTheRoomStanza: mockLeaveTheRoomStanza } }),
}));
const leaveTheRoomStanza = mockLeaveTheRoomStanza;

const JID = 'one@conference.x';
const CHATS = [
  { jid: JID, name: 'one', title: 'One', usersCnt: 2, messages: [], isLoading: false, roomBg: '' },
  { jid: 'two@conference.x', name: 'two', title: 'Two', usersCnt: 3, messages: [], isLoading: false, roomBg: '' },
];

const render = async (config: any = {}) => {
  await act(async () => {
    store.dispatch(setUser({ firstName: 'Ann', token: 'jwt' } as any));
    store.dispatch(setConfig(config));
    CHATS.forEach((roomData) => store.dispatch(addRoom({ roomData } as any)));
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ToastProvider>
          <RoomList chats={CHATS as any} onRoomClick={jest.fn()} />
        </ToastProvider>
      </Provider>
    );
  });
  const find = (testID: string) =>
    tree.root.findAll((n) => n.props?.testID === testID && typeof n.props.onPress === 'function');
  return { tree, find };
};

beforeEach(() => {
  jest.restoreAllMocks();
  leaveTheRoomStanza.mockClear();
});

describe('room-list swipe actions', () => {
  it('leaves the room after a confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.[1]?.onPress?.();
    });
    const { tree, find } = await render();
    expect(find('room-action-report-one').length).toBeGreaterThan(0);
    expect(find('room-action-leave-one').length).toBeGreaterThan(0);

    await act(async () => {
      find('room-action-leave-one')[0].props.onPress();
    });
    expect(alert).toHaveBeenCalledWith('Leave Chat', expect.any(String), expect.any(Array));
    expect(leaveTheRoomStanza).toHaveBeenCalledWith(JID);
    expect(store.getState().rooms.rooms[JID]).toBeUndefined();
    await act(async () => tree.unmount());
  });

  it('keeps the room when the confirmation is declined', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.[0]?.onPress?.();
    });
    const { tree, find } = await render();
    await act(async () => {
      find('room-action-leave-one')[0].props.onPress();
    });
    expect(leaveTheRoomStanza).not.toHaveBeenCalled();
    expect(store.getState().rooms.rooms[JID]).toBeDefined();
    await act(async () => tree.unmount());
  });

  it('opens the report form for that room', async () => {
    const { tree, find } = await render();
    const forms = () => tree.root.findAll((n) => n.props?.visible === true && n.props?.roomJid);
    expect(forms().length).toBe(0);
    await act(async () => {
      find('room-action-report-one')[0].props.onPress();
    });
    // The form is up (its own Modal), for that room.
    expect(forms()[0]?.props.roomJid).toBe(JID);
    await act(async () => tree.unmount());
  });

  it('is off with disableRoomSwipeActions', async () => {
    const { tree, find } = await render({ disableRoomSwipeActions: true });
    expect(find('room-action-leave-one').length).toBe(0);
    expect(find('room-one').length).toBeGreaterThan(0);
    await act(async () => tree.unmount());
  });
});
