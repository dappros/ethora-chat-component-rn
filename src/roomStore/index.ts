import { configureStore, combineReducers } from '@reduxjs/toolkit';
import chatSettingsReducer, { setUser } from './chatSettingsSlice';
import roomsSlice, { addRoom } from './roomsSlice';
import { roomHeapSlice, markMessageFailed } from './roomHeapSlice';
import callReducer from './callSlice';
import { IRoom } from '../types/types';
import { unreadMiddleware } from './Middleware/unreadMidlleware';
import { logoutMiddleware } from './Middleware/logoutMiddleware';
import { newMessageMidlleware } from './Middleware/newMessageMidlleware';
import { reactionsMiddleware } from './Middleware/reactionsMiddleware';
import {
  persistenceMiddleware,
  readPersistedState,
  computeBootTimeFailures,
} from './persistence';

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
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          // Slice names: chatSlice→'chat', roomsStore→'roomMessages'.
          ignoredActions: [
            'chat/addMessage',
            'chat/setStoreClient',
            'chat/setConfig',
            'roomMessages/addRoom',
          ],
          ignoredActionPaths: ['payload.client', 'payload.config'],
          ignoredPaths: [
            'chat.messages.timestamp',
            'chatSettingStore.client',
            'chatSettingStore.config',
          ],
        },
      })
        .concat(unreadMiddleware)
        .concat(newMessageMidlleware)
        .concat(reactionsMiddleware)
        .concat(logoutMiddleware)
        .concat(persistenceMiddleware),
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
      for (const [jid, room] of Object.entries(rooms.rooms)) {
        if (!jid || !room) {continue;}
        store.dispatch(addRoom({ roomData: room as IRoom }));
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
