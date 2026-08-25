import { useDispatch } from 'react-redux';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../roomStore';
import { logout } from '../roomStore/chatSettingsSlice';
import { setLogoutState } from '../roomStore/roomsSlice';
import { useCallback } from 'react';
import { clearHeap } from '../roomStore/roomHeapSlice';
import { pushSubscriptionService } from '../services/pushSubscriptionService';
import { clearRoomsRestCache } from '../networking/api-requests/rooms.api';
import { clearPersistedState } from '../roomStore/persistence';
import { secureUserStorage } from '../helpers/secureUserStorage';

// AsyncStorage keys the library writes but that aren't cleared by any
// slice reducer. Listed here so a single logout call wipes the full
// library footprint, not just the slices it happens to think about.
//
// `@ethora/chat-component-scope` is intentionally NOT included — it
// acts as a per-tenant fingerprint that `ensureScopedChatCache` reads
// on the next bootstrap to detect appId/baseUrl changes and force a
// re-init when needed. Wiping it would just re-stamp it on the next
// login with the same value, no-op churn.
const LIBRARY_STRAY_KEYS = [
  '@ethora/chat-component-qrChatId', // pending QR join target — should not bleed across sessions
];

const logoutService = {
  /**
   * Tear down the active chat session end-to-end:
   *  1. Fire UI-side events (notifications, push, redux slices).
   *  2. The redux dispatch of `chat/logout` triggers
   *     `logoutMiddleware`, which emits `ethora-xmpp-logout` on
   *     `DeviceEventEmitter`. `XmppProvider` listens for that event,
   *     disconnects the XMPP transport, clears the global client
   *     singleton, and awaits `clearPersistedState()` to wipe the
   *     two persisted slice keys.
   *  3. We additionally clear:
   *     - the 60s in-memory REST `/chats/my` cache (stale rooms
   *       leak across user-switch within the cache window otherwise),
   *     - leftover AsyncStorage keys the slices don't touch
   *       (pending QR join target, push subscription set),
   *     - the persistence keys directly (belt-and-suspenders against
   *       the persistence middleware's 200ms debounce silently losing
   *       the post-logout write if the app is killed mid-flush).
   *
   * Returns a Promise so callers can sequence a navigation / restart
   * AFTER all the disk work has actually landed.
   */
  performLogout: async (): Promise<void> => {
    // 0. Flush lastViewedTimestamp to the server's private store BEFORE
    //    we close XMPP. Only rooms with no outstanding unread (plus the
    //    visible room) get their entries updated — rooms with unread
    //    keep their old marker so the next login still surfaces those
    //    messages as unread. Without this, an active-room view at
    //    logout would still appear unread on next login because we
    //    never persisted "I read up to now".
    try {
      const state = store.getState();
      const client = (state.chatSettingStore as any)?.client;
      const rooms = state.rooms?.rooms;
      const visibleRoomJID = state.rooms?.visibleRoomJID || null;
      if (client?.flushLastViewedToPrivateStoreStanza) {
        await Promise.race([
          client.flushLastViewedToPrivateStoreStanza(rooms, {
            visibleRoomJID,
            onlyIfNoUnread: true,
          }),
          new Promise((res) => setTimeout(res, 2000)),
        ]);
      }
    } catch (e) {
      console.warn('logoutService: private store flush failed', e);
    }

    // 1. UI: clear in-app notification toast queue.
    try {
      DeviceEventEmitter.emit('chat:clear-notifications');
    } catch {
      /* non-fatal */
    }

    // 2. Push: clear locally-subscribed-rooms cache. Doesn't talk to the
    //    server — that's the host app's responsibility (it owns the FCM/
    //    APNs token lifecycle).
    try {
      await pushSubscriptionService.reset();
    } catch (e) {
      console.warn('logoutService: push reset failed', e);
    }

    // 3. REST: nuke the in-memory `/chats/my` cache so the next login
    //    doesn't read user A's rooms while user B is bootstrapping.
    try {
      clearRoomsRestCache();
    } catch {
      /* non-fatal */
    }

    // 4. Redux: dispatch the trio. Order matters — `chat/logout` is
    //    what triggers `logoutMiddleware → ethora-xmpp-logout` (and
    //    therefore XmppProvider's `client.disconnect()`), so fire it
    //    AFTER the slices that don't need the xmpp client.
    try {
      store.dispatch(setLogoutState()); // rooms slice → {} + null
      store.dispatch(clearHeap()); // message heap (dedup set)
      store.dispatch(logout()); // chat slice → user wiped + removes ETHORA_USER
    } catch (e) {
      console.warn('logoutService: redux dispatch failed', e);
    }

    // 5. Persisted state: belt-and-suspenders. XmppProvider's logout
    //    listener also calls clearPersistedState, but doing it here too
    //    means the disk is clean before this Promise resolves —
    //    regardless of how fast the event-emitter listener runs.
    try {
      await clearPersistedState();
    } catch {
      /* non-fatal */
    }

    // 6. Stray keys the slices don't touch.
    try {
      await AsyncStorage.multiRemove(LIBRARY_STRAY_KEYS);
    } catch (e) {
      console.warn('logoutService: stray-key clear failed', e);
    }

    // 7. Belt-and-suspenders: the chat slice's `logout` reducer already
    //    fires an async ETHORA_USER removal, but re-issue it here (via
    //    the same secureUserStorage split the reducer uses) so BOTH the
    //    plain-AsyncStorage profile half AND the Keychain/Keystore
    //    secrets are provably gone before this Promise resolves — a bare
    //    `AsyncStorage.removeItem(ETHORA_USER)` here would only clear the
    //    profile half and leave the tokens behind.
    try {
      await secureUserStorage().remove();
    } catch (e) {
      console.warn('logoutService: secure user storage clear failed', e);
    }
  },
};

/**
 * Hook that returns an awaitable logout function.
 *
 * ```tsx
 * const logout = useLogout();
 * await logout();
 * navigation.replace('SignIn'); // disk is provably clean here
 * ```
 *
 * The returned function resolves AFTER all teardown work has landed:
 * XMPP disconnect, redux reset, persisted slices wiped, stray
 * AsyncStorage keys removed, REST cache cleared. It never rejects —
 * any internal failure is logged via console.warn so a fire-and-forget
 * `logout()` call (no `await`) still won't crash the host.
 *
 * Why awaitable: the persistence middleware debounces writes by 200ms,
 * and the chat-slice `logout` reducer removes ETHORA_USER fire-and-
 * forget. If the host navigated / re-mounted `<Chat>` immediately
 * after a non-awaited call, the next bootstrap could occasionally
 * read stale persisted state ("old chats reappear"). Awaiting the
 * returned promise eliminates that race entirely.
 */
export const useLogout = (): (() => Promise<void>) => {
  // dispatch is kept for backward-compat with consumers who treat the
  // hook's presence as a redux-context requirement; not used directly
  // here because the work happens through the module-level service.
  useDispatch();

  return useCallback(async () => {
    try {
      await logoutService.performLogout();
    } catch (err) {
      console.warn('useLogout: performLogout failed', err);
    }
  }, []);
};

export { logoutService };
