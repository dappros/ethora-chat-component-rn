/**
 * The headers tell the user when the chat is not live: "Connecting…" while
 * the stream is down or being set up, "Updating…" while rooms are re-joined
 * and the archive caught up after a (re)connect, and their usual title once
 * that is done. The state comes from the XMPP client's own status, which
 * is mirrored into the store on every change.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  setConfig,
  setConnectionState,
  setUiLocale,
} from '../src/roomStore/chatSettingsSlice';
import { addRoom } from '../src/roomStore/roomsSlice';
import { HeaderRoomList } from '../src/components/Header/HeaderRoomList';
import ChatHeader from '../src/components/MainComponents/ChatHeader';
import XmppClient from '../src/networking/xmppClient';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: null }),
}));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const JID = 'general@conference.xmpp.test';

const render = async (node: React.ReactElement) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{node}</Provider>);
  });
  return tree;
};
const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

beforeEach(async () => {
  await act(async () => {
    store.dispatch(setConfig({} as any));
    store.dispatch(setUiLocale(undefined));
    store.dispatch(setConnectionState('online'));
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'general',
          title: 'General',
          usersCnt: 453,
          messages: [],
          isLoading: false,
          roomBg: '',
        },
      } as any)
    );
  });
});

describe('connection state in the headers', () => {
  it('replaces the list title and the room subtitle, then gives them back', async () => {
    const list = await render(<HeaderRoomList setDrawerOpen={() => {}} />);
    const room = await render(
      <ChatHeader currentRoom={store.getState().rooms.rooms[JID]} />
    );
    expect(text(list)).toContain('Chats');
    expect(text(room)).toContain('453 users');

    await act(async () => {
      store.dispatch(setConnectionState('connecting'));
    });
    expect(text(list)).toContain('Connecting…');
    expect(text(list)).not.toContain('Chats');
    expect(text(room)).toContain('Connecting…');
    expect(text(room)).not.toContain('453 users');

    await act(async () => {
      store.dispatch(setConnectionState('syncing'));
    });
    expect(text(list)).toContain('Updating…');
    expect(text(room)).toContain('Updating…');

    await act(async () => {
      store.dispatch(setConnectionState('online'));
    });
    expect(text(list)).toContain('Chats');
    expect(text(room)).toContain('453 users');

    await act(async () => {
      list.unmount();
      room.unmount();
    });
  });

  it('is in the interface language', async () => {
    await act(async () => {
      store.dispatch(setUiLocale('es-US'));
      store.dispatch(setConnectionState('connecting'));
    });
    const list = await render(<HeaderRoomList setDrawerOpen={() => {}} />);
    expect(text(list)).toContain('Conectando…');
    await act(async () => list.unmount());
  });
});

describe("the client's status", () => {
  it('reaches the store: connecting, online, and offline only once nothing retries', () => {
    // The accessor alone: a constructed client would start connecting.
    const client = Object.create(XmppClient.prototype) as XmppClient;
    (client as any)._status = 'offline';
    client.suppressReconnect = false;
    const connection = () => store.getState().chatSettingStore.connection;

    client.status = 'connecting';
    expect(connection()).toBe('connecting');
    client.status = 'online';
    expect(connection()).toBe('online');
    // A drop with a retry scheduled is, to the user, "connecting".
    client.status = 'offline';
    expect(connection()).toBe('connecting');
    client.status = 'error';
    expect(connection()).toBe('connecting');
    // Logged out: nothing will reconnect, so it is plainly off.
    client.status = 'online';
    client.suppressReconnect = true;
    client.status = 'offline';
    expect(connection()).toBe('offline');
  });
});
