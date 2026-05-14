import { configureStore, combineReducers } from '@reduxjs/toolkit';
import chatSettingsReducer, { setUser } from './chatSettingsSlice';
import roomsSlice, { addRoom } from './roomsSlice';
import { IRoom } from '../types/types';
import { unreadMiddleware } from './Middleware/unreadMidlleware';
import { persistenceMiddleware, readPersistedState } from './persistence';

const rootReducer = combineReducers({
  chatSettingStore: chatSettingsReducer,
  rooms: roomsSlice,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['chat/addMessage', 'chatSettingStore/setStoreClient'],
        ignoredPaths: [
          'chat.messages.timestamp',
          'chatSettingStore.client',
          'chatSettingStore.config',
        ],
      },
    })
      .concat(unreadMiddleware)
      .concat(persistenceMiddleware),
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;

export const getActiveRoom = (state: RootState): IRoom | null => {
  const roomMessagesState = state.rooms;
  return roomMessagesState.activeRoomJID
    ? roomMessagesState.rooms[roomMessagesState.activeRoomJID]
    : null;
};

// Async rehydrate — read persisted slices and replay them as standard
// actions. Idempotent: only rehydrates when a slice has data.
export const persistorReady = (async () => {
  const { chat, rooms } = await readPersistedState();
  if (chat?.user && chat.user.walletAddress) {
    store.dispatch(setUser(chat.user));
  }
  if (rooms?.rooms) {
    for (const [jid, room] of Object.entries(rooms.rooms)) {
      if (!jid || !room) continue;
      store.dispatch(addRoom({ roomData: room as IRoom }));
    }
  }
})();
