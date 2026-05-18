/**
 * Small hooks bundle 2.
 *
 *   - asyncLocalStorage   — key-scoped AsyncStorage helper
 *   - useRoomState        — composite selector for the active room
 *   - useQRCodeChat       — Linking + AsyncStorage → setCurrentRoom
 *   - usePendingNotification — reads pending JID from AsyncStorage
 *
 * Heavier hooks (useSendMessage / useChatWrapperInit / useHeapSender /
 * usePushNotifications) are deferred to a later round; they pull in
 * the xmppProvider context + lots of service singletons.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

import roomsReducer, {
  addRoom,
  setCurrentRoom,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import {
  asyncLocalStorage,
  useLocalStorage,
} from '../src/hooks/useLocalStorage';
import { useRoomState } from '../src/hooks/useRoomState';
import { useQRCodeChat, handleQRChatId } from '../src/hooks/useQRCodeChatHandler';
import { usePendingNotification } from '../src/hooks/usePendingNotification';

// Source imports `Linking` from 'react-native' (the re-export), so we
// spy on the live export rather than mocking the deep module path —
// the latter doesn't intercept the re-export.
import { Linking } from 'react-native';
let getInitialURLSpy: jest.SpyInstance;
beforeAll(() => {
  getInitialURLSpy = jest
    .spyOn(Linking, 'getInitialURL')
    .mockResolvedValue(null);
});
afterAll(() => {
  getInitialURLSpy?.mockRestore?.();
});

const makeStore = () =>
  configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ---- asyncLocalStorage ---------------------------------------------

describe('asyncLocalStorage', () => {
  it('round-trips a value through set / get / remove', async () => {
    const store = asyncLocalStorage<{ a: number }>('@scope/a');
    expect(await store.get()).toBeNull();
    await store.set({ a: 1 });
    expect(await store.get()).toEqual({ a: 1 });
    await store.remove();
    expect(await store.get()).toBeNull();
  });

  it('update merges partial values onto the existing record', async () => {
    const store = asyncLocalStorage<{ a: number; b: number }>('@scope/b');
    await store.set({ a: 1, b: 2 });
    await store.update({ b: 99 });
    expect(await store.get()).toEqual({ a: 1, b: 99 });
  });

  it('update writes the partial alone when nothing was previously stored', async () => {
    const store = asyncLocalStorage<{ a: number; b?: number }>('@scope/c');
    await store.update({ a: 42 });
    expect(await store.get()).toEqual({ a: 42 });
  });

  it('useLocalStorage is the same function as asyncLocalStorage (back-compat alias)', () => {
    expect(useLocalStorage).toBe(asyncLocalStorage);
  });

  it('logs and returns null when AsyncStorage holds invalid JSON', async () => {
    await AsyncStorage.setItem('@scope/d', 'not-json{');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await asyncLocalStorage<any>('@scope/d').get();
    expect(out).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---- useRoomState ---------------------------------------------------

const RoomStateProbe: React.FC<{
  jid?: string;
  onSnapshot: (s: ReturnType<typeof useRoomState>) => void;
}> = ({ jid, onSnapshot }) => {
  const s = useRoomState(jid);
  React.useEffect(() => onSnapshot(s));
  return <Text testID="probe">x</Text>;
};

const mountWithStore = async (
  store: ReturnType<typeof makeStore>,
  ui: React.ReactElement
): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{ui}</Provider>);
  });
  return tree!;
};

describe('useRoomState', () => {
  it('returns the selected room + rooms map + activeRoomJID', async () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: {
          id: 'a@h',
          name: 'a',
          jid: 'a@h',
          title: 'A',
          usersCnt: 0,
          messages: [],
          isLoading: false,
          roomBg: '',
        } as any,
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'a@h' }));
    let snap!: any;
    await mountWithStore(
      store,
      <RoomStateProbe jid="a@h" onSnapshot={(s) => (snap = s)} />
    );
    expect(snap.room?.title).toBe('A');
    expect(snap.activeRoomJID).toBe('a@h');
    expect(snap.roomsList['a@h']).toBeDefined();
  });

  it('roomMessages mirrors the active room', async () => {
    const store = makeStore();
    store.dispatch(
      addRoom({
        roomData: {
          id: 'a@h',
          name: 'a',
          jid: 'a@h',
          title: 'A',
          usersCnt: 0,
          messages: [
            { id: 'm1', body: 'hi', date: '2026-05-15', user: { id: 'u' }, roomJid: 'a@h' },
          ],
          isLoading: false,
          roomBg: '',
        } as any,
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: 'a@h' }));
    let snap!: any;
    await mountWithStore(
      store,
      <RoomStateProbe onSnapshot={(s) => (snap = s)} />
    );
    expect(snap.roomMessages).toHaveLength(1);
    expect(snap.roomMessages[0].body).toBe('hi');
  });

  it('room is undefined when no jid is passed', async () => {
    const store = makeStore();
    let snap!: any;
    await mountWithStore(
      store,
      <RoomStateProbe onSnapshot={(s) => (snap = s)} />
    );
    expect(snap.room).toBeUndefined();
  });
});

// ---- useQRCodeChat --------------------------------------------------

const QRProbe: React.FC<{
  setCurrentRoom: (p: { roomJID: string }) => void;
  conferenceServer?: string;
  onReady: (api: { wasAutoSelected: boolean }) => void;
}> = ({ setCurrentRoom, conferenceServer, onReady }) => {
  const api = useQRCodeChat(setCurrentRoom, conferenceServer);
  React.useEffect(() => {
    onReady(api);
  });
  return <Text>qr</Text>;
};

describe('handleQRChatId + useQRCodeChat', () => {
  it('handleQRChatId stores qrChatId from the initial URL', async () => {
    // Use a standard https URL — Node's URL parser handles custom
    // schemes inconsistently between versions, and the source helper
    // only cares about the search-params portion.
    getInitialURLSpy.mockResolvedValueOnce(
      'https://app.test/chat?qrChatId=room-42'
    );
    await handleQRChatId();
    expect(await AsyncStorage.getItem('@ethora/chat-component-qrChatId')).toBe(
      'room-42'
    );
  });

  it('handleQRChatId is a no-op when the URL has no qrChatId', async () => {
    getInitialURLSpy.mockResolvedValueOnce(
      'https://app.test/chat'
    );
    await handleQRChatId();
    expect(await AsyncStorage.getItem('@ethora/chat-component-qrChatId')).toBeNull();
  });

  it('useQRCodeChat reads the stored id, calls setCurrentRoom with `<id>@<conf>`, clears storage, sets wasAutoSelected', async () => {
    await AsyncStorage.setItem('@ethora/chat-component-qrChatId', 'r-1');
    getInitialURLSpy.mockResolvedValueOnce(null);

    const setRoom = jest.fn();
    let api!: { wasAutoSelected: boolean };
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <QRProbe
          setCurrentRoom={setRoom}
          conferenceServer="conference.h"
          onReady={(a) => (api = a)}
        />
      );
    });
    // Let the second effect flush.
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(setRoom).toHaveBeenCalledWith({ roomJID: 'r-1@conference.h' });
    expect(
      await AsyncStorage.getItem('@ethora/chat-component-qrChatId')
    ).toBeNull();
    expect(api.wasAutoSelected).toBe(true);
    tree!.unmount();
  });

  it('useQRCodeChat falls back to the default conference when none is supplied', async () => {
    await AsyncStorage.setItem('@ethora/chat-component-qrChatId', 'r-2');
    getInitialURLSpy.mockResolvedValueOnce(null);

    const setRoom = jest.fn();
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <QRProbe setCurrentRoom={setRoom} onReady={() => {}} />
      );
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(setRoom).toHaveBeenCalledWith({
      roomJID: 'r-2@conference.xmpp.ethoradev.com',
    });
    tree!.unmount();
  });

  it('useQRCodeChat is a no-op when no QR id is stored', async () => {
    getInitialURLSpy.mockResolvedValueOnce(null);
    const setRoom = jest.fn();
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <QRProbe setCurrentRoom={setRoom} onReady={() => {}} />
      );
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(setRoom).not.toHaveBeenCalled();
    tree!.unmount();
  });
});

// ---- usePendingNotification ----------------------------------------

const PendingProbe: React.FC<{
  onReady: (api: ReturnType<typeof usePendingNotification>) => void;
}> = ({ onReady }) => {
  const api = usePendingNotification();
  React.useEffect(() => onReady(api));
  return <Text>pending</Text>;
};

describe('usePendingNotification', () => {
  it('returns the redux pendingNotificationJid', async () => {
    const store = makeStore();
    let snap!: any;
    await mountWithStore(
      store,
      <PendingProbe onReady={(s) => (snap = s)} />
    );
    expect(snap.pendingNotificationJid).toBeNull();
  });

  it('reads + clears the AsyncStorage pending jid on mount when redux value is absent', async () => {
    const store = makeStore();
    await AsyncStorage.setItem(
      'ethora_pending_notification_jid',
      'pending-room@h'
    );
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <PendingProbe onReady={() => {}} />
        </Provider>
      );
    });
    // The effect awaits AsyncStorage; flush microtasks.
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      await AsyncStorage.getItem('ethora_pending_notification_jid')
    ).toBeNull();
    tree!.unmount();
  });

  it('does NOT read AsyncStorage while isLoading=true', async () => {
    const store = makeStore();
    store.dispatch({
      type: 'roomMessages/setIsLoading',
      payload: { loading: true },
    });
    await AsyncStorage.setItem(
      'ethora_pending_notification_jid',
      'still-here@h'
    );
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <PendingProbe onReady={() => {}} />
        </Provider>
      );
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    // Still there — not touched.
    expect(
      await AsyncStorage.getItem('ethora_pending_notification_jid')
    ).toBe('still-here@h');
    tree!.unmount();
  });
});
