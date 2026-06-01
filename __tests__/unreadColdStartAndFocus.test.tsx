/**
 * Locks in two unread fixes reported by the integrator:
 *  - cold-start badge: addRoom must NOT let an incoming lastViewedTimestamp
 *    of 0 (stanzaHandlers placeholder) overwrite a persisted marker (#19/#20).
 *  - useChatRoomFocus: in tab navigators where <ChatRoom> stays mounted,
 *    blur must release the active-room marker so unread counts again (#19).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider as ReduxProvider } from 'react-redux';

import { store } from '../src/roomStore';
import {
  addRoom,
  addRoomMessage,
  setCurrentRoom,
  setLogoutState,
} from '../src/roomStore/roomsSlice';
import { logout, setUser } from '../src/roomStore/chatSettingsSlice';
import { clearHeap } from '../src/roomStore/roomHeapSlice';
import { useUnreadMessagesCounter as useUnread } from '../src/hooks/useUnreadMessagesCounter';
import { useChatRoomFocus } from '../src/hooks/useChatRoomFocus';

const R = 'cs@conference.xmpp.chat.ethora.com';
const LV = Date.parse('2026-05-15T10:00:00Z');
const mkRoom = (jid: string, lastViewedTimestamp?: number) =>
  ({ id: jid, jid, name: jid, title: jid, usersCnt: 1, messages: [], isLoading: false, roomBg: '', lastViewedTimestamp } as any);
const msg = (id: string, date: string, fromSelf: boolean) =>
  ({ id, user: { id: fromSelf ? 'self-user' : 'other', name: 'u', token: '', refreshToken: '' }, date, body: 'hi', roomJid: R } as any);

const reset = () => {
  store.dispatch(setLogoutState());
  store.dispatch(logout());
  store.dispatch(clearHeap());
  store.dispatch(setUser({ xmppUsername: 'self-user', walletAddress: '0xS' } as any));
};

describe('addRoom cold-start: incoming 0 must not clobber a persisted marker', () => {
  beforeEach(reset);

  it('preserves an existing lastViewedTimestamp when addRoom re-fires with 0', () => {
    store.dispatch(addRoom({ roomData: mkRoom(R, 1700000000000) }));
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(1700000000000);
    // stanzaHandlers-style re-add with the 0 placeholder.
    store.dispatch(addRoom({ roomData: mkRoom(R, 0) }));
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(1700000000000);
  });

  it('still honours a real (non-zero) explicit value', () => {
    store.dispatch(addRoom({ roomData: mkRoom(R, 1700000000000) }));
    store.dispatch(addRoom({ roomData: mkRoom(R, 1800000000000) }));
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(1800000000000);
  });
});

describe('useChatRoomFocus: blur releases active room so unread counts (tabs)', () => {
  beforeEach(reset);

  it('focus marks the room visible without zeroing lastViewed; blur stamps a real timestamp and later messages count', async () => {
    store.dispatch(addRoom({ roomData: mkRoom(R, LV) }));

    let snap: any;
    let focused = true;
    const Probe = () => {
      useChatRoomFocus({ roomJID: R, isFocused: focused });
      snap = useUnread();
      return null;
    };
    let tree: any;
    const render = () =>
      tree.update(
        <ReduxProvider store={store}>
          <Probe />
        </ReduxProvider>
      );

    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Probe />
        </ReduxProvider>
      );
    });
    expect(store.getState().rooms.visibleRoomJID).toBe(R);
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(LV);

    // Focused -> visible room suppresses unread without mutating the persisted marker.
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg('m1', new Date(LV + 3600_000).toISOString(), false) }));
    });
    expect(snap.totalCount).toBe(0);

    // Blur -> release visible room + stamp now.
    focused = false;
    await act(async () => { render(); });
    const blurTs = store.getState().rooms.rooms[R].lastViewedTimestamp;
    expect(store.getState().rooms.visibleRoomJID).toBeNull();
    expect(blurTs).toBeGreaterThan(LV);
    // A message that arrives AFTER blur must now count.
    await act(async () => {
      store.dispatch(addRoomMessage({ roomJID: R, message: msg('m2', new Date(blurTs + 3600_000).toISOString(), false) }));
    });
    expect(snap.unreadByRoom[R]).toBeGreaterThanOrEqual(1);
    expect(snap.totalCount).toBeGreaterThanOrEqual(1);

    // Re-focus -> visible again and unread clears without rewriting the marker to 0.
    focused = true;
    await act(async () => { render(); });
    expect(snap.totalCount).toBe(0);
    expect(store.getState().rooms.visibleRoomJID).toBe(R);
    expect(store.getState().rooms.rooms[R].lastViewedTimestamp).toBe(blurTs);

    await act(async () => {
      tree.unmount();
    });
  });
});
