import { configureStore, combineReducers } from '@reduxjs/toolkit';
import chatSettingsReducer, { setUser } from './chatSettingsSlice';
import roomsSlice, { addRoom } from './roomsSlice';
import { roomHeapSlice } from './roomHeapSlice';
import callReducer from './callSlice';
import { IRoom } from '../types/types';
import { unreadMiddleware } from './Middleware/unreadMidlleware';
import { logoutMiddleware } from './Middleware/logoutMiddleware';
import { newMessageMidlleware } from './Middleware/newMessageMidlleware';
import { reactionsMiddleware } from './Middleware/reactionsMiddleware';
import { persistenceMiddleware, readPersistedState } from './persistence';

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

// Async rehydrate — read persisted slices and replay them as standard
export const persistorReady =
  globalScope.__CHAT_PERSISTOR_READY__ ||
  (globalScope.__CHAT_PERSISTOR_READY__ = (async () => {
    const { chat, rooms } = await readPersistedState();
    if (chat?.user && chat.user.walletAddress) {
      store.dispatch(setUser(chat.user));
    }
    if (rooms?.rooms) {
      for (const [jid, room] of Object.entries(rooms.rooms)) {
        if (!jid || !room) {continue;}
        store.dispatch(addRoom({ roomData: room as IRoom }));
      }
    }
  })());
