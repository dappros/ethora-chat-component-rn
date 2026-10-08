import { configureStore, combineReducers } from '@reduxjs/toolkit';
import chatSettingsReducer, { setUser } from './chatSettingsSlice';
import roomsSlice, { addRooms } from './roomsSlice';
import { roomHeapSlice, markMessageFailed } from './roomHeapSlice';
import callReducer from './callSlice';
import { IRoom } from '../types/types';
import { unreadMiddleware } from './Middleware/unreadMidlleware';
import { logoutMiddleware } from './Middleware/logoutMiddleware';
import { newMessageMidlleware } from './Middleware/newMessageMidlleware';
import { reactionsMiddleware } from './Middleware/reactionsMiddleware';
import { jumpThreadMiddleware } from './Middleware/jumpThreadMiddleware';
import { isPerfProfilingEnabled, perfMiddleware } from './Middleware/perfMiddleware';
import {
  persistenceMiddleware,
  readPersistedState,
  computeBootTimeFailures,
  resetSessionRoomState,
} from './persistence';

export { resetSessionRoomState };

const rootReducer = combineReducers({
  chatSettingStore: chatSettingsReducer,
  rooms: roomsSlice,
  roomHeapSlice: roomHeapSlice.reducer,
  // Live call state. Deliberately NOT persisted: a call that was ringing
  // when the app was killed is over by the time it reopens, and restoring
  // it would put the user straight into a dead LiveKit room.
  call: callReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

const createChatStore = () =>
  configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => {
      const base = getDefaultMiddleware({
        // Both dev-only invariant checks walk the WHOLE state on every
        // action. With rooms + message history in the store that took
        // 60-80 ms per dispatch (RTK's own "took Xms" warning), blocking
        // the JS thread long enough to make taps feel dead in dev builds.
        // Production builds never ran them.
        serializableCheck: false,
        immutableCheck: false,
      });
      const chain = [
        unreadMiddleware,
        newMessageMidlleware,
        reactionsMiddleware,
        jumpThreadMiddleware,
        logoutMiddleware,
        persistenceMiddleware,
      ];
      return isPerfProfilingEnabled()
        ? base.concat(perfMiddleware, ...chain)
        : base.concat(...chain);
    },
  });

const globalScope = globalThis as typeof globalThis & {
  __CHAT_STORE__?: ReturnType<typeof createChatStore>;
  __CHAT_PERSISTOR_READY__?: Promise<void>;
};

export const store =
  globalScope.__CHAT_STORE__ ||
  (globalScope.__CHAT_STORE__ = createChatStore());

export type AppDispatch = typeof store.dispatch;

export const getActiveRoom = (state: RootState): IRoom | null => {
  const roomMessagesState = state.rooms;
  return roomMessagesState.activeRoomJID
    ? roomMessagesState.rooms[roomMessagesState.activeRoomJID]
    : null;
};

// Async rehydrate: read persisted slices and replay them as standard
// actions.
export const persistorReady =
  globalScope.__CHAT_PERSISTOR_READY__ ||
  (globalScope.__CHAT_PERSISTOR_READY__ = (async () => {
    const { chat, rooms, heap } = await readPersistedState();
    if (chat?.user && chat.user.walletAddress) {
      store.dispatch(setUser(chat.user));
    }
    if (rooms?.rooms) {
      // Per-session state (preload progress, the API unread snapshot) must
      // not outlive the session that produced it.
      const restored = Object.values(
        resetSessionRoomState(rooms.rooms as Record<string, IRoom>)
      ).filter((room) => !!room && !!room.jid) as IRoom[];
      if (restored.length) {
        store.dispatch(addRooms({ rooms: restored }));
      }
    }

    // bug #39: restore failures that were already flagged (watchdog or
    // an explicit send error) before the app was killed, so the bubble
    // still shows "Failed / tap to retry" instead of quietly reverting
    // to a normal sent bubble.
    // Skip entries whose bubble no longer exists in the restored cache.
    // A failure flag is only ever READ as `failedMessages[message.id]`,
    // so one with no matching message is dead weight that would be
    // replayed and re-persisted on every launch forever. This happens
    // for real: a send that reached the server but whose echo was lost
    // gets flagged failed at boot, then the history merge replaces the
    // optimistic bubble with the archived copy under its server id (see
    // mergeHistoryIntoCache), leaving the flag behind.
    const restoredFailed = heap?.failedMessages || {};
    for (const payload of Object.values(restoredFailed)) {
      const stillRendered = (
        rooms?.rooms?.[payload.roomJID]?.messages || []
      ).some((m) => m?.id === payload.id);
      if (!stillRendered) {continue;}
      store.dispatch(markMessageFailed(payload));
    }

    // bug #39: a message that was still `pending: true` at kill time
    // never got a server echo AND never got the chance to trip the
    // in-session send watchdog (messageHeap is process-lifetime only,
    // never persisted). Treat every such message as failed so it gets
    // a working retry instead of silently rendering as delivered.
    const bootFailures = computeBootTimeFailures(rooms?.rooms, restoredFailed);
    for (const payload of bootFailures) {
      store.dispatch(markMessageFailed(payload));
    }
  })());
