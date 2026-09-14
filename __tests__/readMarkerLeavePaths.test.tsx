/**
 * Bug #42 (a regression of #33, reintroduced by #38): leaving a room
 * while scrolled up must stamp the read marker at the boundary the user
 * actually reached, not at the newest server-acked message - and that
 * boundary has to be a single source of truth every "leaving this room"
 * path can read, not just a ref private to <ChatRoom>.
 *
 * Covers:
 *  - roomsSlice's `readBoundaries` reducer (setReadBoundary / clearReadBoundary)
 *  - useChatRoomFocus's `leaveRoom`: stamps the boundary, passes it as
 *    `visibleRoomTs` to the flush, and only releases the boundary on a
 *    genuine room change/unmount (not a same-room blur)
 *  - xmppProvider's `isVisible=false` handler
 *  - xmppProvider's AppState background handler
 *  - xmppProvider's live `advance()` effect: must not advance the marker
 *    past the boundary while one is set
 */
import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider as ReduxProvider } from 'react-redux';
import { AppState } from 'react-native';

import { store } from '../src/roomStore';
import {
  addRoom,
  addRoomMessage,
  setCurrentRoom,
  setVisibleRoom,
  setLogoutState,
  setReadBoundary,
  clearReadBoundary,
  deleteAllRooms,
} from '../src/roomStore/roomsSlice';
import { logout, setUser, setStoreClient } from '../src/roomStore/chatSettingsSlice';
import { clearHeap } from '../src/roomStore/roomHeapSlice';
import { useChatRoomFocus } from '../src/hooks/useChatRoomFocus';
import { XmppProvider, useXmppClient } from '../src/context/xmppProvider';
import type { IRoom } from '../src/types/types';

// Injects a fake XmppClient directly into <XmppProvider>'s internal state
// via the `setClient` the context exposes - the provider only ever gets a
// real client through its heavy `initBeforeLoad` bootstrap, which needs a
// live XMPP server. The AppState background handler bails out entirely
// with no client (`if (!c) {return;}`), so exercising it at all requires
// this shortcut.
const ClientInjector: React.FC<{ client: any }> = ({ client }) => {
  const { setClient } = useXmppClient();
  useEffect(() => {
    setClient(client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const makeFakeClient = () => ({
  status: 'online',
  isSuspended: false,
  suspend: jest.fn().mockResolvedValue(undefined),
  forceReconnect: jest.fn(),
  flushLastViewedToPrivateStoreStanza: jest.fn().mockResolvedValue(true),
});

const R = 'boundary@conference.xmpp.chat.ethora.com';
const N_MS = Date.parse('2026-05-15T10:00:00Z');

const mkRoom = (jid: string, lastViewedTimestamp?: number, messages: any[] = []): IRoom =>
  ({
    id: jid,
    jid,
    name: jid,
    title: jid,
    usersCnt: 1,
    messages,
    isLoading: false,
    roomBg: '',
    lastViewedTimestamp,
  } as any);

const msg = (idMs: number) =>
  ({
    id: String(idMs),
    user: { id: 'other', name: 'Other', token: '', refreshToken: '' },
    date: new Date(idMs).toISOString(),
    body: 'hi',
    roomJid: R,
  } as any);

const reset = async () => {
  store.dispatch(setLogoutState());
  store.dispatch(logout());
  store.dispatch(clearHeap());
  store.dispatch(setUser({ xmppUsername: 'self-user', walletAddress: '0xS' } as any));
  // logoutMiddleware schedules a 0ms setTimeout that emits the global
  // 'ethora-xmpp-logout' DeviceEventEmitter event, which every mounted
  // XmppProvider listens for and reacts to by calling `setClient(null)`.
  // Left pending, that timer can fire in the middle of a LATER test's own
  // `act()` (any `await` yields to it) and race a freshly-mounted
  // provider's client - let it drain here instead.
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('roomsSlice - readBoundaries reducer', () => {
  beforeEach(reset);

  it('setReadBoundary stores a positive boundary; clearReadBoundary removes it', () => {
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));
    expect(store.getState().rooms.readBoundaries[R]).toBe(N_MS);

    store.dispatch(clearReadBoundary({ jid: R }));
    expect(store.getState().rooms.readBoundaries[R]).toBeUndefined();
  });

  it('setReadBoundary with null/0/negative clears rather than storing', () => {
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));
    store.dispatch(setReadBoundary({ jid: R, ts: null }));
    expect(store.getState().rooms.readBoundaries[R]).toBeUndefined();

    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));
    store.dispatch(setReadBoundary({ jid: R, ts: 0 }));
    expect(store.getState().rooms.readBoundaries[R]).toBeUndefined();
  });

  it('deleteAllRooms and setLogoutState reset the whole map', () => {
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));
    store.dispatch(deleteAllRooms());
    expect(store.getState().rooms.readBoundaries).toEqual({});

    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));
    store.dispatch(setLogoutState());
    expect(store.getState().rooms.readBoundaries).toEqual({});
  });
});

describe('useChatRoomFocus - leaving while scrolled up stamps the boundary, not the newest message', () => {
  beforeEach(reset);

  const mountProbe = (initialRoomJID: string | null, initialFocused: boolean) => {
    let props = { roomJID: initialRoomJID, isFocused: initialFocused };
    const Probe = () => {
      useChatRoomFocus(props as any);
      return null;
    };
    let tree: any;
    const rerender = (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      act(() => {
        tree.update(
          <ReduxProvider store={store}>
            <Probe />
          </ReduxProvider>
        );
      });
    };
    act(() => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Probe />
        </ReduxProvider>
      );
    });
    return { rerender, unmount: () => act(() => tree.unmount()) };
  };

  it('blur with a boundary set stamps the boundary (not the newest message) and passes it as visibleRoomTs to the flush', () => {
    // Two messages received while scrolled up; the user only reached the
    // first one (N_MS) before leaving.
    store.dispatch(
      addRoom({
        roomData: mkRoom(R, undefined, [msg(N_MS), msg(N_MS + 5000)]),
      })
    );
    const flush = jest.fn().mockResolvedValue(true);
    store.dispatch(setStoreClient({ flushLastViewedToPrivateStoreStanza: flush } as any));

    const { rerender, unmount } = mountProbe(R, true);
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));

    // Blur (same room) → leaveRoom fires.
    rerender({ isFocused: false });

    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(N_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][1]).toMatchObject({
      visibleRoomJID: R,
      visibleRoomTs: N_MS,
    });
    // Same-room blur must NOT release the boundary - MessageList (if
    // mounted) still has it live in its own ref.
    expect(store.getState().rooms.readBoundaries[R]).toBe(N_MS);

    unmount();
  });

  it('switching to a different room releases the boundary of the room being left', () => {
    const R2 = 'other@conference.xmpp.chat.ethora.com';
    store.dispatch(addRoom({ roomData: mkRoom(R, undefined, [msg(N_MS)]) }));
    store.dispatch(addRoom({ roomData: mkRoom(R2, undefined, [msg(N_MS)]) }));
    store.dispatch(setStoreClient({ flushLastViewedToPrivateStoreStanza: jest.fn().mockResolvedValue(true) } as any));

    const { rerender, unmount } = mountProbe(R, true);
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));

    rerender({ roomJID: R2 });

    expect(store.getState().rooms.readBoundaries[R]).toBeUndefined();

    unmount();
  });

  it('unmounting while focused releases the boundary', () => {
    store.dispatch(addRoom({ roomData: mkRoom(R, undefined, [msg(N_MS)]) }));
    store.dispatch(setStoreClient({ flushLastViewedToPrivateStoreStanza: jest.fn().mockResolvedValue(true) } as any));

    const { unmount } = mountProbe(R, true);
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));

    unmount();

    expect(store.getState().rooms.readBoundaries[R]).toBeUndefined();
  });
});

describe('xmppProvider - isVisible=false honours the read boundary', () => {
  beforeEach(reset);

  it('hiding with a boundary set stamps the boundary, not the newest acked message', async () => {
    store.dispatch(
      addRoom({ roomData: mkRoom(R, undefined, [msg(N_MS), msg(N_MS + 5000)]) })
    );
    store.dispatch(setCurrentRoom({ roomJID: R }));

    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <XmppProvider config={{} as any} isVisible={true}>
            {null}
          </XmppProvider>
        </ReduxProvider>
      );
    });

    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));

    await act(async () => {
      tree.update(
        <ReduxProvider store={store}>
          <XmppProvider config={{} as any} isVisible={false}>
            {null}
          </XmppProvider>
        </ReduxProvider>
      );
    });

    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(N_MS);
    // Not cleared - MessageList typically stays mounted through an
    // isVisible=false toggle (that's the whole point of the prop).
    expect(store.getState().rooms.readBoundaries[R]).toBe(N_MS);

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('xmppProvider - AppState background handler honours the read boundary', () => {
  beforeEach(reset);

  let handlers: Record<string, (state: string) => void>;

  beforeEach(() => {
    handlers = {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((type: string, cb: any) => {
      handlers[type] = cb;
      return { remove: () => { delete handlers[type]; } } as any;
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('backgrounding with a boundary set stamps the boundary, not the newest acked message', async () => {
    store.dispatch(
      addRoom({ roomData: mkRoom(R, undefined, [msg(N_MS), msg(N_MS + 5000)]) })
    );
    store.dispatch(setCurrentRoom({ roomJID: R }));

    // The handler bails out entirely with no client (`if (!c) {return;}`),
    // so a fake one has to be injected for this path to run at all.
    const fakeClient = makeFakeClient();
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <XmppProvider config={{} as any}>
            <ClientInjector client={fakeClient} />
          </XmppProvider>
        </ReduxProvider>
      );
    });

    // Mirror ChatRoom's mount: this room is now "visible".
    store.dispatch(setVisibleRoom({ roomJID: R }));
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));

    await act(async () => {
      handlers['change']?.('background');
    });

    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(N_MS);
    // Backgrounding must not release the boundary either.
    expect(store.getState().rooms.readBoundaries[R]).toBe(N_MS);
    // The SERVER marker carries the same boundary - without this the
    // flush would default to "everything" for the visible room.
    expect(fakeClient.flushLastViewedToPrivateStoreStanza).toHaveBeenCalled();
    const lastCall =
      fakeClient.flushLastViewedToPrivateStoreStanza.mock.calls[
        fakeClient.flushLastViewedToPrivateStoreStanza.mock.calls.length - 1
      ];
    expect(lastCall[1]).toMatchObject({
      visibleRoomJID: R,
      visibleRoomTs: N_MS,
    });

    await act(async () => {
      tree.unmount();
    });
  });
});

describe('xmppProvider - advance() does not move the marker past the boundary while scrolled up', () => {
  beforeEach(reset);

  it('a message arriving while a boundary is set does not advance lastViewedTimestamp past it', async () => {
    store.dispatch(addRoom({ roomData: mkRoom(R, undefined, [msg(N_MS)]) }));
    store.dispatch(setCurrentRoom({ roomJID: R }));

    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <XmppProvider config={{} as any} isVisible={true}>
            {null}
          </XmppProvider>
        </ReduxProvider>
      );
    });

    const afterOpen = store.getState().rooms.rooms[R].lastViewedTimestamp;
    expect(afterOpen).toBeGreaterThanOrEqual(N_MS);

    // User scrolls up: a boundary is set at N_MS (they've only reached
    // the first message).
    store.dispatch(setReadBoundary({ jid: R, ts: N_MS }));

    // Two more messages arrive while still scrolled up.
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg(N_MS + 1000) }));
    });
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg(N_MS + 2000) }));
    });

    // The marker must stay clamped at the boundary throughout - not
    // creep forward to the newest incoming message (bug #42).
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(N_MS);

    // Scrolling back to the bottom clears the boundary; the marker can
    // now advance again.
    store.dispatch(clearReadBoundary({ jid: R }));
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg(N_MS + 3000) }));
    });
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(N_MS + 3000);

    await act(async () => {
      tree.unmount();
    });
  });
});
