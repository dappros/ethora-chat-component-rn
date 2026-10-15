/**
 * The XEP-0333 read watermark rides on the visible room's private-store
 * flush (xmppProvider's live advance() effect, one 2 s debounce). It goes out
 * once per newest message, only while the room is on screen, never inside a
 * jump window, and not when read markers are switched off.
 */
import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider as ReduxProvider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  addRoom,
  addRoomMessage,
  clearJumpWindow,
  setCurrentRoom,
  setJumpWindow,
  setLogoutState,
} from '../src/roomStore/roomsSlice';
import { logout, setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { clearHeap } from '../src/roomStore/roomHeapSlice';
import { XmppProvider, useXmppClient } from '../src/context/xmppProvider';
import type { IRoom } from '../src/types/types';

const R = 'watermark@conference.xmpp.chat.ethora.com';
const ME = 'self-user';
const OTHER = 'other-user';
const T0 = 1747303200000;

const ClientInjector: React.FC<{ client: any }> = ({ client }) => {
  const { setClient } = useXmppClient();
  useEffect(() => {
    setClient(client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const makeClient = () => ({
  status: 'online',
  isSuspended: false,
  suspend: jest.fn().mockResolvedValue(undefined),
  forceReconnect: jest.fn(),
  flushLastViewedToPrivateStoreStanza: jest.fn().mockResolvedValue(true),
  sendDisplayedMarkerStanza: jest.fn(),
});

const msg = (idMs: number, from = OTHER) =>
  ({
    id: String(idMs),
    user: { id: from, name: from, token: '', refreshToken: '' },
    date: new Date(idMs).toISOString(),
    body: `m${idMs}`,
    roomJid: R,
  } as any);

const mkRoom = (messages: any[] = []): IRoom =>
  ({
    id: R,
    jid: R,
    name: R,
    title: R,
    usersCnt: 2,
    messages,
    isLoading: false,
    roomBg: '',
    type: 'public',
  } as any);

let tree: any = null;

beforeEach(() => {
  jest.useFakeTimers();
  store.dispatch(setLogoutState());
  store.dispatch(logout());
  store.dispatch(clearHeap());
  store.dispatch(setConfig({} as any));
  store.dispatch(setUser({ xmppUsername: ME, walletAddress: '0xS' } as any));
  jest.runOnlyPendingTimers();
});

afterEach(async () => {
  if (tree) {
    await act(async () => {
      tree.unmount();
    });
    tree = null;
  }
  jest.useRealTimers();
});

const mount = async (client: any) => {
  await act(async () => {
    tree = renderer.create(
      <ReduxProvider store={store}>
        <XmppProvider config={{} as any} isVisible={true}>
          <ClientInjector client={client} />
        </XmppProvider>
      </ReduxProvider>
    );
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

describe('read watermark on the visible-room debounce', () => {
  it('sends the newest message from someone else once the 2 s debounce settles', async () => {
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    const client = makeClient();
    await mount(client);
    await advance(2100);
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledTimes(1);
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledWith(String(T0), R);
    // The private-store write still happens on the same debounce.
    expect(client.flushLastViewedToPrivateStoreStanza).toHaveBeenCalled();
  });

  it('a burst of messages inside one debounce sends a single watermark, for the newest', async () => {
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    const client = makeClient();
    await mount(client);
    await advance(1000);
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg(T0 + 1000) }));
    });
    await advance(1000);
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg(T0 + 2000) }));
    });
    await advance(2100);
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledTimes(1);
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledWith(String(T0 + 2000), R);
  });

  it('does not send for the reader own newest message', async () => {
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0, ME)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    const client = makeClient();
    await mount(client);
    await advance(2100);
    expect(client.sendDisplayedMarkerStanza).not.toHaveBeenCalled();
  });

  it('does not send while a jump window shows old history of this room', async () => {
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    store.dispatch(
      setJumpWindow({
        roomJID: R,
        targetId: String(T0),
        messages: [msg(T0)],
        olderCursor: null,
        hasOlder: false,
        newerCursor: null,
        hasNewer: false,
      } as any)
    );
    const client = makeClient();
    await mount(client);
    await advance(2100);
    expect(client.sendDisplayedMarkerStanza).not.toHaveBeenCalled();
    store.dispatch(clearJumpWindow());
  });

  it('is switched off by config.disableReadReceipts, while the private-store write still runs', async () => {
    store.dispatch(setConfig({ disableReadReceipts: true } as any));
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    const client = makeClient();
    await mount(client);
    await advance(2100);
    expect(client.sendDisplayedMarkerStanza).not.toHaveBeenCalled();
    expect(client.flushLastViewedToPrivateStoreStanza).toHaveBeenCalled();
  });

  it('sends the waiting watermark when the app is left before the 2 s debounce ends', async () => {
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    const client = makeClient();
    await mount(client);
    await advance(500);
    expect(client.sendDisplayedMarkerStanza).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
    tree = null;
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledTimes(1);
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledWith(String(T0), R);
    // The cancelled timer must not send a second one.
    await advance(2100);
    expect(client.sendDisplayedMarkerStanza).toHaveBeenCalledTimes(1);
  });

  it('leaving early does not send while a jump window is open', async () => {
    store.dispatch(addRoom({ roomData: mkRoom([msg(T0)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));
    const client = makeClient();
    await mount(client);
    await advance(500);
    store.dispatch(
      setJumpWindow({
        roomJID: R,
        targetId: String(T0),
        messages: [msg(T0)],
        olderCursor: null,
        hasOlder: false,
        newerCursor: null,
        hasNewer: false,
      } as any)
    );
    await act(async () => {
      tree.unmount();
    });
    tree = null;
    expect(client.sendDisplayedMarkerStanza).not.toHaveBeenCalled();
    store.dispatch(clearJumpWindow());
  });
});
