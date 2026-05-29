/**
 * Exercises the PUBLIC `useUnread` hook (the one consumers import from
 * the library entry) through a full sequence of state perturbations,
 * asserting the LIVE hook return (hasUnread / totalCount / unreadByRoom)
 * re-renders correctly after EACH change — not just a one-shot snapshot.
 *
 * Perturbation matrix (each step builds on the previous):
 *   P1  baseline (no rooms)                  → empty
 *   P2  incoming from OTHER, non-active room → counted
 *   P3  incoming from SELF                   → NOT counted
 *   P4  message OLDER than lastViewed        → NOT counted
 *   P5  second room incoming                 → aggregates across rooms
 *   P6  enter room (setCurrentRoom + lv=0)   → that room cleared
 *   P7  incoming to the ACTIVE room          → stays cleared
 *   P8  pending message                      → NOT counted
 *   P9  leave room (lv=now)                   → read room cleared, other retained
 *   P10 logout                               → everything cleared
 *   P11 re-login + new room                  → fresh counts, no stale carryover
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider as ReduxProvider } from 'react-redux';

import { store } from '../src/roomStore';
import {
  addRoom,
  addRoomMessage,
  setCurrentRoom,
  setLastViewedTimestamp,
  setLogoutState,
} from '../src/roomStore/roomsSlice';
import { logout, setUser } from '../src/roomStore/chatSettingsSlice';
import { clearHeap } from '../src/roomStore/roomHeapSlice';
import { useUnreadMessagesCounter as useUnread } from '../src/hooks/useUnreadMessagesCounter';

describe('useUnread hook — live perturbations', () => {
  const SELF = {
    xmppUsername: 'self-user',
    walletAddress: '0xSELF',
    firstName: 'Self',
    lastName: 'U',
    token: '',
    refreshToken: '',
  } as any;

  const LV = Date.parse('2026-05-15T10:00:00Z');
  const newer = (n: number) => new Date(LV + n * 3600_000).toISOString();
  const older = new Date(LV - 3600_000).toISOString();

  const A = 'pa@conference.xmpp.chat.ethora.com';
  const B = 'pb@conference.xmpp.chat.ethora.com';
  const C = 'pc@conference.xmpp.chat.ethora.com';

  const mkRoom = (jid: string) =>
    ({
      id: jid,
      jid,
      name: jid,
      title: jid,
      usersCnt: 1,
      messages: [],
      isLoading: false,
      roomBg: '',
      lastViewedTimestamp: LV,
    } as any);

  const msg = (id: string, date: string, fromSelf: boolean, extra: any = {}) =>
    ({
      id,
      user: {
        id: fromSelf ? 'self-user' : 'other-user',
        name: 'u',
        token: '',
        refreshToken: '',
      },
      date,
      body: 'hi',
      roomJid: '',
      ...extra,
    } as any);

  let snap: any;
  let tree: any;
  const Probe = () => {
    snap = useUnread();
    return null;
  };

  beforeAll(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(logout());
    store.dispatch(clearHeap());
    store.dispatch(setUser(SELF));
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Probe />
        </ReduxProvider>
      );
    });
  });
  afterAll(() => {
    tree?.unmount();
  });

  const step = async (fn: () => void) => {
    await act(async () => {
      fn();
    });
  };

  it('P1 baseline: no rooms → empty', () => {
    expect(snap.totalCount).toBe(0);
    expect(snap.hasUnread).toBe(false);
    expect(snap.unreadByRoom).toEqual({});
  });

  it('P2 incoming from OTHER in a non-active room → counted (hook re-renders)', async () => {
    await step(() => store.dispatch(addRoom({ roomData: mkRoom(A) })));
    await step(() =>
      store.dispatch(
        addRoomMessage({ roomJID: A, message: msg('a1', newer(1), false), start: true })
      )
    );
    expect(snap.unreadByRoom[A]).toBe(1);
    expect(snap.totalCount).toBe(1);
    expect(snap.hasUnread).toBe(true);
  });

  it('P3 incoming from SELF → NOT counted', async () => {
    await step(() =>
      store.dispatch(addRoomMessage({ roomJID: A, message: msg('a2', newer(2), true) }))
    );
    expect(snap.unreadByRoom[A]).toBe(1);
    expect(snap.totalCount).toBe(1);
  });

  it('P4 message OLDER than lastViewed → NOT counted', async () => {
    await step(() =>
      store.dispatch(addRoomMessage({ roomJID: A, message: msg('a0', older, false) }))
    );
    expect(snap.unreadByRoom[A]).toBe(1);
  });

  it('P5 second room incoming → aggregates across rooms', async () => {
    await step(() => store.dispatch(addRoom({ roomData: mkRoom(B) })));
    await step(() =>
      store.dispatch(
        addRoomMessage({ roomJID: B, message: msg('b1', newer(1), false), start: true })
      )
    );
    expect(snap.unreadByRoom[A]).toBe(1);
    expect(snap.unreadByRoom[B]).toBe(1);
    expect(snap.totalCount).toBe(2);
  });

  it('P6 enter room A (active + lastViewed=0) → A cleared', async () => {
    await step(() => {
      store.dispatch(setCurrentRoom({ roomJID: A }));
      store.dispatch(setLastViewedTimestamp({ chatJID: A, timestamp: 0 }));
    });
    expect(snap.unreadByRoom[A]).toBeUndefined();
    expect(snap.totalCount).toBe(1); // B only
  });

  it('P7 incoming to the ACTIVE room → stays cleared', async () => {
    await step(() =>
      store.dispatch(addRoomMessage({ roomJID: A, message: msg('a3', newer(3), false) }))
    );
    expect(snap.unreadByRoom[A]).toBeUndefined();
    expect(snap.totalCount).toBe(1);
  });

  it('P8 pending message → NOT counted', async () => {
    await step(() =>
      store.dispatch(
        addRoomMessage({
          roomJID: B,
          message: msg('b2', newer(2), false, { pending: true }),
        })
      )
    );
    expect(snap.unreadByRoom[B]).toBe(1); // pending excluded
    expect(snap.totalCount).toBe(1);
  });

  it('P9 leave room A (lastViewed=now) → A cleared, B retained', async () => {
    await step(() => {
      store.dispatch(setCurrentRoom({ roomJID: null as any }));
      store.dispatch(setLastViewedTimestamp({ chatJID: A, timestamp: Date.now() }));
    });
    expect(snap.unreadByRoom[A]).toBeUndefined();
    expect(snap.unreadByRoom[B]).toBe(1);
    expect(snap.totalCount).toBe(1);
  });

  it('P10 logout → everything cleared', async () => {
    await step(() => {
      store.dispatch(setLogoutState());
      store.dispatch(logout());
      store.dispatch(clearHeap());
    });
    expect(snap.totalCount).toBe(0);
    expect(snap.hasUnread).toBe(false);
    expect(snap.unreadByRoom).toEqual({});
  });

  it('P11 re-login + new room → fresh counts, no stale carryover', async () => {
    await step(() => store.dispatch(setUser(SELF)));
    await step(() => store.dispatch(addRoom({ roomData: mkRoom(C) })));
    await step(() =>
      store.dispatch(
        addRoomMessage({ roomJID: C, message: msg('c1', newer(1), false), start: true })
      )
    );
    expect(snap.unreadByRoom[C]).toBe(1);
    expect(snap.unreadByRoom[A]).toBeUndefined();
    expect(snap.unreadByRoom[B]).toBeUndefined();
    expect(snap.totalCount).toBe(1);
  });
});
