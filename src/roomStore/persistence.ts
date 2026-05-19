import AsyncStorage from '@react-native-async-storage/async-storage';
import { Middleware } from '@reduxjs/toolkit';
import { IMessage, IRoom, User } from '../types/types';

// -------------------------------------------------------------------
// Lightweight RN persistence layer. Mirrors what redux-persist gives
// the web component:
//
//   - persist chatSettingStore.user (sanitized) and rooms state
//   - blacklist transient fields (modals, activeRoomJID, etc.)
//   - cap each room's messages to the most recent MESSAGE_LIMIT (100)
//   - debounced writes (200ms) on relevant action types
//
// Not encrypted. We rely on AsyncStorage's per-app sandbox.
// -------------------------------------------------------------------

const KEY_CHAT = '@ethora/persist:chatSettingStore';
const KEY_ROOMS = '@ethora/persist:rooms';

// Per-room message cap on disk. Mirror this value in `roomsSlice`'s
// in-memory cap (see `enforceMessageCap`) so the runtime and persisted
// shapes stay aligned.
export const MESSAGE_LIMIT = 100;

interface PersistedChatState {
  user: User;
}

interface PersistedRoomsState {
  rooms: Record<string, IRoom>;
  // intentionally NOT persisted: activeRoomJID, editAction, isLoading
}

const sanitizeUser = (user?: User): User | null => {
  if (!user) {return null;}
  // Drop secrets we don't want at rest — destructure to omit, then
  // explicitly zero them in the persisted shape.
  const {
    token: _token,
    refreshToken: _refreshToken,
    xmppPassword: _xmppPassword,
    ...rest
  } = user as any;
  return {
    ...rest,
    token: '',
    refreshToken: '',
    xmppPassword: '',
  } as User;
};

const sanitizeMessages = (messages: IMessage[]): IMessage[] => {
  if (!Array.isArray(messages)) {return [];}
  if (messages.length <= MESSAGE_LIMIT) {return messages;}
  return messages.slice(-MESSAGE_LIMIT);
};

const sanitizeRooms = (
  rooms: Record<string, IRoom>
): Record<string, IRoom> => {
  if (!rooms || typeof rooms !== 'object') {return {};}
  const out: Record<string, IRoom> = {};
  for (const [jid, room] of Object.entries(rooms)) {
    if (!jid || typeof jid !== 'string' || !jid.includes('@')) {continue;}
    if (!room || typeof room !== 'object' || Array.isArray(room)) {continue;}
    out[jid] = {
      ...room,
      messages: sanitizeMessages(room?.messages || []),
      composing: false,
      composingList: [],
      isLoading: false,
      historyPreloadState: 'idle',
    };
  }
  return out;
};

let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Middleware that debounces writes of the persisted slices to AsyncStorage.
 * Only triggers on actions that actually mutate persisted state.
 */
export const persistenceMiddleware: Middleware = (storeAPI) => (next) => (
  action: any
) => {
  const result = next(action);

  const type: string = action?.type || '';
  if (
    !type.startsWith('roomMessages/') &&
    !type.startsWith('chat/setUser') &&
    !type.startsWith('chat/updateUser') &&
    !type.startsWith('chat/refreshTokens') &&
    !type.startsWith('chat/logout')
  ) {
    return result;
  }

  if (writeTimer) {clearTimeout(writeTimer);}
  writeTimer = setTimeout(() => {
    try {
      const state = storeAPI.getState();
      const chatPayload: PersistedChatState = {
        user: sanitizeUser(state.chatSettingStore?.user) as User,
      };
      const roomsPayload: PersistedRoomsState = {
        rooms: sanitizeRooms(state.rooms?.rooms || {}),
      };
      AsyncStorage.multiSet([
        [KEY_CHAT, JSON.stringify(chatPayload)],
        [KEY_ROOMS, JSON.stringify(roomsPayload)],
      ]).catch((e) => console.warn('persist write failed', e));
    } catch (e) {
      console.warn('persist serialize failed', e);
    }
  }, 200);

  return result;
};

/**
 * Read persisted slices from AsyncStorage. Called once at store creation;
 * we DON'T hydrate synchronously (AsyncStorage is async) — instead, the
 * caller dispatches rehydrate actions when the read resolves.
 */
export async function readPersistedState(): Promise<{
  chat: PersistedChatState | null;
  rooms: PersistedRoomsState | null;
}> {
  try {
    const [chatRaw, roomsRaw] = await AsyncStorage.multiGet([
      KEY_CHAT,
      KEY_ROOMS,
    ]);
    const chat = chatRaw[1] ? (JSON.parse(chatRaw[1]) as PersistedChatState) : null;
    const rooms = roomsRaw[1]
      ? (JSON.parse(roomsRaw[1]) as PersistedRoomsState)
      : null;
    return { chat, rooms };
  } catch (e) {
    console.warn('persist read failed', e);
    return { chat: null, rooms: null };
  }
}

export async function clearPersistedState(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY_CHAT, KEY_ROOMS]);
  } catch (e) {
    console.warn('persist clear failed', e);
  }
}

export const PERSIST_KEYS = { KEY_CHAT, KEY_ROOMS };
