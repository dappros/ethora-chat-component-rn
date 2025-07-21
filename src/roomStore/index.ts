import { configureStore, combineReducers } from '@reduxjs/toolkit';
import chatSettingsReducer from './chatSettingsSlice';
import roomsSlice from './roomsSlice';
import { IRoom } from '../types/types';
import { unreadMiddleware } from './Middleware/unreadMidlleware';
import { newMessageMidlleware } from './Middleware/newMessageMidlleware';
import { logoutMiddleware } from './Middleware/logoutMiddleware';

import { persistReducer, persistStore, createTransform } from 'redux-persist';
import CryptoJS from 'crypto-js';
import storage from 'redux-persist/lib/storage';
import roomHeapSlice from './roomHeapSlice';
import { reactionsMiddleware } from './Middleware/reactionsMiddleware';

const debugMiddleware = (storeAPI) => (next) => (action) => {
  if (typeof action !== 'object' || action === null) {
    console.error('Non-plain object action detected:', action);
    console.error('Action type:', typeof action);
    console.error('Action constructor:', action?.constructor?.name);
    console.error('Stack trace:', new Error().stack);
    throw new Error(
      'Actions must be plain objects. Received: ' + typeof action
    );
  }

  if (!action.type) {
    console.error('Action missing type property:', action);
    console.error('Stack trace:', new Error().stack);
    throw new Error('Actions must have a type property');
  }

  if (
    (action.type && action.type.endsWith('/pending')) ||
    (action.type && action.type.endsWith('/fulfilled')) ||
    (action.type && action.type.endsWith('/rejected'))
  ) {
    if (!action.payload && !action.meta && !action.error) {
      console.warn('Thunk action missing expected properties:', action);
    }
  }

  return next(action);
};

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
  storage,
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
  storage,
  blacklist: ['editAction', 'activeRoomJID', 'loadingText'],
  transforms: [limitMessagesTransform],
};

const roomHeapSliceConfig = {
  key: 'roomHeapSlice',
  storage,
};

const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['chatSettingStore', 'roomMessages'],
  blacklist: ['routing'],
  transforms: [encryptTransform],
};

const rootReducer = combineReducers({
  chatSettingStore: persistReducer(chatSettingPersistConfig, chatSettingsReducer),
  rooms: persistReducer(roomsPersistConfig, roomsSlice),
  roomHeapSlice: persistReducer(roomHeapSliceConfig, roomHeapSlice),
});

export type RootState = ReturnType<typeof rootReducer>;

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      thunk: true,
      serializableCheck: {
        ignoredActions: [
          'chat/addMessage',
          'persist/PERSIST',
          'persist/REHYDRATE',
          'roomMessages/addRoomViaApi/pending',
          'roomMessages/addRoomViaApi/fulfilled',
          'roomMessages/addRoomViaApi/rejected',
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
      .concat(logoutMiddleware)
      .concat(reactionsMiddleware),
      // .concat(testMiddleware)
      // .concat(debugMiddleware)
      // .concat(actionLoggerMiddleware),
});


export type AppDispatch = typeof store.dispatch;

export const getActiveRoom = (state: RootState): IRoom | null => {
  const roomMessagesState = state.rooms;
  return roomMessagesState.activeRoomJID
    ? roomMessagesState.rooms[roomMessagesState.activeRoomJID]
    : null;
};

export const persistor = persistStore(store);
