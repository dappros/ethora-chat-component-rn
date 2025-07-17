import { configureStore, combineReducers } from '@reduxjs/toolkit';
import chatSettingsReducer from './chatSettingsSlice';
import roomsSlice from './roomsSlice';
import { IRoom } from '../types/types';
import { unreadMiddleware } from './Middleware/unreadMidlleware';
import { newMessageMidlleware } from './Middleware/newMessageMidlleware';
import { logoutMiddleware } from './Middleware/logoutMiddleware';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { persistReducer, persistStore, createTransform } from 'redux-persist';
import CryptoJS from 'crypto-js';
import type { PersistPartial } from 'redux-persist/es/persistReducer';

const SECRET_KEY = 'hey-this-is-dappros';

const encryptTransform = createTransform(
  (inboundState: any) => {
    try {
      const encrypted = CryptoJS.AES.encrypt(
        JSON.stringify(inboundState),
        SECRET_KEY
      ).toString();
      return encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      return inboundState;
    }
  },
  // outbound: при загрузке
  (outboundState: any) => {
    try {
      const bytes = CryptoJS.AES.decrypt(outboundState, SECRET_KEY);
      const decrypted = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return outboundState;
    }
  }
);

const limitMessagesTransform = createTransform(
  (inboundState: { [jid: string]: IRoom }) => {
    if (!inboundState || Object.keys(inboundState).length < 1) {
      return inboundState;
    }

    const rooms = { ...inboundState };
    for (const jid in rooms) {
      if (rooms[jid]?.messages?.length > 50) {
        rooms[jid] = {
          ...rooms[jid],
          messages: rooms[jid].messages.slice(-50),
        };
      }
    }
    return { ...rooms };
  },
  (outboundState: { [jid: string]: IRoom }) => outboundState
);

const chatSettingPersistConfig = {
  key: 'chatSettingStore',
  storage: AsyncStorage,
  blacklist: [
    'activeModal',
    'deleteModal',
    'selectedUser',
    'activeFile',
    'config.refreshTokens',
    'refreshTokens',
    'client',
  ],
  transforms: [encryptTransform],
};

const roomsPersistConfig = {
  key: 'roomMessages',
  storage: AsyncStorage,
  blacklist: ['editAction', 'activeRoomJID', 'loadingText'],
  transforms: [limitMessagesTransform],
};

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['chatSettingStore', 'roomMessages'],
  blacklist: ['routing'],
  transforms: [encryptTransform],
};

const rootReducer = combineReducers({
  chatSettingStore: persistReducer(chatSettingPersistConfig, chatSettingsReducer),
  rooms: persistReducer(roomsPersistConfig, roomsSlice),
});

export type RootState = ReturnType<typeof rootReducer>;

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          'chat/addMessage',
          'persist/PERSIST',
          'persist/REHYDRATE',
        ],
        ignoredPaths: [
          'chat.messages.timestamp',
          'chatSettingStore.client',
          'chatSettingStore.config',
        ],
      },
    })
      .concat(unreadMiddleware)
      .concat(newMessageMidlleware)
      .concat(logoutMiddleware),
});


export type AppDispatch = typeof store.dispatch;

export const getActiveRoom = (state: RootState): IRoom | null => {
  const roomMessagesState = state.rooms;
  return roomMessagesState.activeRoomJID
    ? roomMessagesState.rooms[roomMessagesState.activeRoomJID]
    : null;
};

export const persistor = persistStore(store);
