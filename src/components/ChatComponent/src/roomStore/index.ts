import {configureStore, combineReducers} from '@reduxjs/toolkit';
import chatSettingsReducer from './chatSettingsSlice';
import roomsSlice from './roomsSlice';
import {IRoom} from '../types/types';
import {unreadMiddleware} from './Middleware/unreadMidlleware';

const rootReducer = combineReducers({
  chatSettingStore: chatSettingsReducer,
  rooms: roomsSlice,
});

export const getActiveRoom = (state: RootState): IRoom | null => {
  const roomMessagesState = state.rooms;
  return roomMessagesState.activeRoomJID
    ? roomMessagesState.rooms[roomMessagesState.activeRoomJID]
    : null;
};

export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['chat/addMessage', 'chatSettingStore/setStoreClient'],
        ignoredPaths: [
          'chat.messages.timestamp',
          'chatSettingStore.client',
          'chatSettingStore.config.headerMenu',
          'chatSettingStore.config.customRooms.rooms',
          'chatSettingStore.config.headerChatMenu',
          'chatSettingStore.config.backgroundChat.image',
          'chatSettingStore.config.headerLogo',
          'chatSettingStore.config.emptyChatLogo',
          'chatSettingStore.config.refreshTokens.refreshFunction',
        ],
        ignoredActions: ['chatSettingStore/setConfig'],
        serializableCheck: false,
      },
    }).concat(unreadMiddleware),
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
