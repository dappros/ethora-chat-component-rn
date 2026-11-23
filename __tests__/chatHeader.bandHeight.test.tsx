/**
 * The chat header must size to the title + subtitle, so "N users" is never
 * cut off at the bottom. That happened on Android, where text lines are
 * taller than on iOS: the avatar + title row (ChatContainerHeaderBoxInfo)
 * had flex:1 inside CenterContainer's column, i.e. flex-basis 0, so Yoga
 * gave it CenterContainer's 40px minimum instead of its content, and its
 * overflow:hidden clipped the rest. The band has a minimum height, not a
 * fixed one, for the same reason. Jest does not run Yoga, so this pins the
 * style contract that avoids it.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { addRoom, setLogoutState } from '../src/roomStore/roomsSlice';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import ChatHeader from '../src/components/MainComponents/ChatHeader';
import { ChatContainerHeaderBoxInfo } from '../src/components/styled/StyledComponents';
import { DEFAULT_HEADER_HEIGHT } from '../src/helpers/headerLayout';

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: { leaveTheRoomStanza: jest.fn() } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 30, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/components/MenuRoom/MenuRoom', () => ({ RoomMenu: () => null }));
jest.mock('../src/components/VideoCalls/CallButtons', () => ({
  CallButtons: () => null,
}));
jest.mock('../src/components/MainComponents/MessageSearchButton', () => ({
  MessageSearchButton: () => null,
}));
jest.mock('../src/components/MainComponents/LanguageSelectorButton', () => ({
  LanguageSelectorButton: () => null,
}));

const JID = 'band@conference.xmpp.example.com';

const renderBand = async (config: any) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(setConfig(config));
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'band',
          title: 'Random talks',
          usersCnt: 493,
          messages: [],
          isLoading: false,
          roomBg: '',
        },
      } as any)
    );
  });
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ChatHeader currentRoom={store.getState().rooms.rooms[JID]} />
      </Provider>
    );
  });
  // The band is the outermost host View carrying the header's minHeight.
  const band = tree.root.findAll(
    (n) => typeof n.type === 'string' && StyleSheet.flatten(n.props.style)?.minHeight != null
  )[0];
  return StyleSheet.flatten(band.props.style);
};

const renderBoxInfo = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(setConfig({}));
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'band',
          title: 'Random talks',
          usersCnt: 493,
          messages: [],
          isLoading: false,
          roomBg: '',
        },
      } as any)
    );
  });
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ChatHeader currentRoom={store.getState().rooms.rooms[JID]} />
      </Provider>
    );
  });
  const box = tree.root.findByType(ChatContainerHeaderBoxInfo).findByType(TouchableOpacity);
  return StyleSheet.flatten(box.props.style);
};

describe('ChatHeader band height', () => {
  it('is a minimum of 64, never a fixed height', async () => {
    const style = await renderBand({});
    expect(style.minHeight).toBe(DEFAULT_HEADER_HEIGHT);
    expect(style.height).toBeUndefined();
  });

  it('takes a taller headerLayout.height and the safe-area inset as its minimum', async () => {
    const style = await renderBand({ headerLayout: { height: 80, safeAreaTop: true } });
    expect(style.minHeight).toBe(80 + 30);
    expect(style.paddingTop).toBe(30);
    expect(style.height).toBeUndefined();
  });
});

describe('ChatHeader avatar + title row', () => {
  it('takes the height of its content, not a flex share of the 40px minimum', async () => {
    const style = await renderBoxInfo();
    expect(style.flex).toBeUndefined();
    expect(style.flexGrow).toBeUndefined();
    expect(style.flexBasis).toBeUndefined();
    expect(style.height).toBeUndefined();
    expect(style.flexDirection).toBe('row');
    expect(style.width).toBe('100%');
  });
});
