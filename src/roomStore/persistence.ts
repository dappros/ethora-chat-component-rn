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

// What a persisted message is FOR: instantly painting a recent transcript
// on reload before MAM catches up. That needs the fields the bubbles and
// room-list previews actually read, nothing else. Everything outside this
// list is either re-derived on render or re-fetched from the server.
const PERSISTED_MESSAGE_FIELDS: (keyof IMessage)[] = [
  'id',
  'xmppId',
  'xmppFrom',
  'body',
  'date',
  'timestamp',
  'roomJid',
  'isSystemMessage',
  'isMediafile',
  'isDeleted',
  'isEdited',
  'isReply',
  'showInChannel',
  'mainMessage',
  'mimetype',
  'location',
  'locationPreview',
  'fileName',
  'originalName',
  'size',
  'langSource',
  // `translations` is deliberately NOT here — same as the web SDK's
  // persist list (web src/roomStore/index.ts PERSISTED_MESSAGE_FIELDS):
  // MAM re-hydration restores it on the next history page, now that the
  // history parser reads the <translations> element at all (see
  // onMessageHistory). Cached messages therefore show their translation
  // again after the first MAM sync, exactly like web.
  'callLog',
];

// The sender identity that rides along on every message over the wire
// (senderFirstName / senderLastName / photo, which createMessageFromXml
// folds into message.user) is NOT what the UI reads back, and is not ours
// to cache: `usersSet` is the canonical store for names and avatars, and
// the renderers resolve through it, re-deriving the name every time
// usersSet updates. That is what keeps a renamed user from staying stale.
//
// Persisting a copy per message duplicated the same handful of identities
// across every message of every room, and optimistic sends spread the
// ENTIRE logged-in user into message.user (see useSendMessage), auth
// material included.
//
// Keep `id` (the key usersSet is looked up by) and `name`, nothing else.
// `name` earns its ~15 chars: broadcast/system senders ("Ethora") never
// enter usersSet at all, so for those the message is the only place the
// name exists.
const PERSISTED_MESSAGE_USER_FIELDS = ['id', 'name'] as const;

// Room fields that are pure server state, re-fetched on every load, and so
// must never sit in the message cache, let alone compete with messages for
// AsyncStorage space.
//
// `members` is the one that matters. A 3.5k-member room serializes to
// roughly 840k chars, several hundred times the rest of the room object
// put together. A handful of such rooms is megabytes of roster written on
// every debounce tick, and on Android AsyncStorage that means blown
// cursor-window limits and multi-second writes, for data createRoomFromApi
// repopulates from /chats/my on the very next load. `usersCnt`, which the
// header actually reads, is its own scalar field and is preserved below.
const REFETCHED_ROOM_FIELDS = ['members'] as const;

const pickDefined = <T extends object>(
  source: T,
  keys: readonly (keyof T)[]
): Partial<T> => {
  const out: Partial<T> = {};
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
};

const compactMessageForPersist = (message: IMessage): IMessage => {
  const compact = pickDefined(message, PERSISTED_MESSAGE_FIELDS) as IMessage;
  const user = message?.user as Record<string, any> | undefined;
  if (user) {
    compact.user = pickDefined(
      user,
      PERSISTED_MESSAGE_USER_FIELDS as unknown as readonly string[]
    ) as IMessage['user'];
  }
  return compact;
};

const sanitizeMessages = (messages: IMessage[]): IMessage[] => {
  if (!Array.isArray(messages)) {return [];}
  const capped =
    messages.length > MESSAGE_LIMIT
      ? messages.slice(-MESSAGE_LIMIT)
      : messages;
  return capped.map(compactMessageForPersist);
};

const sanitizeRooms = (
  rooms: Record<string, IRoom>
): Record<string, IRoom> => {
  if (!rooms || typeof rooms !== 'object') {return {};}
  const out: Record<string, IRoom> = {};
  for (const [jid, room] of Object.entries(rooms)) {
    if (!jid || typeof jid !== 'string' || !jid.includes('@')) {continue;}
    if (!room || typeof room !== 'object' || Array.isArray(room)) {continue;}

    const compactRoom = { ...room } as Record<string, any>;
    // Preserve the count the header reads before dropping the roster it
    // would otherwise be derived from.
    if (compactRoom.usersCnt === undefined && Array.isArray(room.members)) {
      compactRoom.usersCnt = room.members.length;
    }
    for (const field of REFETCHED_ROOM_FIELDS) {
      delete compactRoom[field];
    }

    out[jid] = {
      ...(compactRoom as IRoom),
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
