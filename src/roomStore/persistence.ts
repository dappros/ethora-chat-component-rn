import AsyncStorage from '@react-native-async-storage/async-storage';
import { Middleware } from '@reduxjs/toolkit';
import { IMessage, IRoom, User } from '../types/types';
import { encryptForPersist, decryptFromPersist } from '../helpers/persistCrypto';
import type { FailedMessagePayload } from './roomHeapSlice';

// -------------------------------------------------------------------
// Lightweight RN persistence layer. Mirrors what redux-persist gives
// the web component:
//
//   - persist chatSettingStore.user (sanitized) and rooms state
//   - blacklist transient fields (modals, activeRoomJID, etc.)
//   - cap each room's messages to the most recent MESSAGE_LIMIT (100)
//   - debounced writes (200ms) on relevant action types
//
// AES-256-CBC at rest (see `helpers/persistCrypto.ts`): the JSON blob
// under each key below is encrypted before it reaches AsyncStorage, with
// the symmetric key held in the platform Keychain/Keystore. `user` here
// is already secret-free (see `sanitizeUser`) — the encryption is for
// the message bodies in `rooms`, which aren't.
// -------------------------------------------------------------------

const KEY_CHAT = '@ethora/persist:chatSettingStore';
const KEY_ROOMS = '@ethora/persist:rooms';
// bug #39: a failed send needs to survive a relaunch as "failed / tap
// to retry", not silently render as delivered. `roomHeapStore.failedMessages`
// is the map the bubble reads (`isFailed = failedMessages[id]`, see
// Message.tsx / useMessageHeapState): it lives in a separate, previously
// non-persisted slice from `rooms`, so it gets its own key here.
const KEY_HEAP = '@ethora/persist:roomHeap';

// Per-room message cap on disk. Mirror this value in `roomsSlice`'s
// in-memory cap (see `enforceMessageCap`) so the runtime and persisted
// shapes stay aligned.
export const MESSAGE_LIMIT = 100;

// Defensive cap on the number of failed-message payloads written to
// disk. In practice this map only grows while the user is actively
// sending offline, but a runaway sender (or a bug that never clears an
// entry) must not turn this key into an unbounded write.
export const MAX_PERSISTED_FAILED_MESSAGES = 200;

interface PersistedChatState {
  user: User;
}

interface PersistedRoomsState {
  rooms: Record<string, IRoom>;
  // intentionally NOT persisted: activeRoomJID, editAction, isLoading
}

interface PersistedHeapState {
  failedMessages: Record<string, FailedMessagePayload>;
  // intentionally NOT persisted: messageHeap, a process-lifetime
  // "in flight" buffer (see roomHeapSlice.ts); anything still in it when
  // the app dies is handled by the boot-time pending->failed scan below,
  // not by replaying the heap itself.
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
  'callLog',
  // bug #39: without this, a message that was still in flight (no
  // server echo yet) at kill time comes back from disk indistinguishable
  // from a normal delivered message, so the bubble renders it as sent.
  // Persisting `pending` lets the boot-time scan (see
  // computeBootTimeFailures below) find exactly the messages that never
  // got confirmed and flip them to failed instead.
  'pending',
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

// Only the fields retryMessage actually needs to replay the send (see
// FailedMessagePayload / useSendMessage.retryMessage). In particular, the
// media `data` blob is trimmed to `uri/type/name/size` (the picker never
// hands us auth material, but this stays defensive against a future
// picker change smuggling extra fields, or a huge inline payload, into
// `data`).
const sanitizeMediaData = (
  data: any
): { uri?: string; type?: string; name?: string; size?: number } => {
  if (!data || typeof data !== 'object') {return {};}
  const out: { uri?: string; type?: string; name?: string; size?: number } = {};
  if (typeof data.uri === 'string') {out.uri = data.uri;}
  if (typeof data.type === 'string') {out.type = data.type;}
  if (typeof data.name === 'string') {out.name = data.name;}
  if (typeof data.size === 'number') {out.size = data.size;}
  return out;
};

const sanitizeFailedMessagePayload = (
  payload: FailedMessagePayload
): FailedMessagePayload | null => {
  if (!payload || typeof payload !== 'object') {return null;}
  if (!payload.id || typeof payload.id !== 'string') {return null;}
  if (!payload.roomJID || typeof payload.roomJID !== 'string') {return null;}
  if (payload.kind === 'media') {
    return {
      kind: 'media',
      id: payload.id,
      roomJID: payload.roomJID,
      data: sanitizeMediaData(payload.data),
      type: typeof payload.type === 'string' ? payload.type : '',
      isReply: payload.isReply,
      isChecked: payload.isChecked,
      mainMessage: payload.mainMessage,
    };
  }
  if (payload.kind === 'text') {
    return {
      kind: 'text',
      id: payload.id,
      roomJID: payload.roomJID,
      body: typeof payload.body === 'string' ? payload.body : '',
      isReply: payload.isReply,
      isChecked: payload.isChecked,
      mainMessage: payload.mainMessage,
    };
  }
  return null;
};

const sanitizeFailedMessages = (
  failedMessages: Record<string, FailedMessagePayload> | undefined
): Record<string, FailedMessagePayload> => {
  if (!failedMessages || typeof failedMessages !== 'object') {return {};}
  const out: Record<string, FailedMessagePayload> = {};
  let count = 0;
  for (const [id, payload] of Object.entries(failedMessages)) {
    if (count >= MAX_PERSISTED_FAILED_MESSAGES) {break;}
    const clean = sanitizeFailedMessagePayload(payload);
    if (clean) {
      out[id] = clean;
      count++;
    }
  }
  return out;
};

// -------------------------------------------------------------------
// Boot-time pending -> failed conversion (bug #39).
//
// `messageHeap` (the "still sending" buffer) is intentionally NOT
// persisted: it's a process-lifetime thing. That means on a cold start
// there is no such thing as "still sending": a persisted message that
// carries `pending: true` never got a server echo NOR got the chance to
// trip the in-session watchdog (see PENDING_WATCHDOG_MS in
// useSendMessage.tsx) before the process died. It must render as failed
// with a working retry, not as delivered and not as stuck "sending...".
//
// Reconstructs the same FailedMessagePayload shape the live send path
// builds in useSendMessage (markMessageFailed calls), from the fields we
// persist per message.
// -------------------------------------------------------------------

export function reconstructFailedMessagePayload(
  message: IMessage,
  roomJID: string
): FailedMessagePayload | null {
  if (!message?.id || !roomJID) {return null;}
  const isReply = !!message.isReply;
  const isChecked = message.showInChannel === 'true';
  const mainMessage = message.mainMessage;
  if (message.isMediafile === 'true') {
    return {
      kind: 'media',
      id: message.id,
      roomJID,
      data: sanitizeMediaData({
        uri: message.location,
        name: message.fileName,
        type: message.mimetype,
        size:
          message.size !== undefined && message.size !== null
            ? Number(message.size)
            : undefined,
      }),
      type: message.mimetype || '',
      isReply,
      isChecked,
      mainMessage,
    };
  }
  return {
    kind: 'text',
    id: message.id,
    roomJID,
    body: message.body || '',
    isReply,
    isChecked,
    mainMessage,
  };
}

/**
 * Scan every persisted room for messages still `pending: true` that
 * DON'T already have a restored failure entry (those are handled by the
 * caller separately, from the persisted `failedMessages` map), and
 * synthesize a retry-able FailedMessagePayload for each. Pure function:
 * the caller (roomStore/index.ts) is responsible for dispatching
 * `markMessageFailed` for the results.
 */
export function computeBootTimeFailures(
  rooms: Record<string, IRoom> | null | undefined,
  alreadyFailed: Record<string, FailedMessagePayload> | null | undefined
): FailedMessagePayload[] {
  if (!rooms || typeof rooms !== 'object') {return [];}
  const out: FailedMessagePayload[] = [];
  for (const [jid, room] of Object.entries(rooms)) {
    const messages = Array.isArray(room?.messages) ? room.messages : [];
    for (const message of messages) {
      if (!message || !message.pending) {continue;}
      if (alreadyFailed && alreadyFailed[message.id]) {continue;}
      const payload = reconstructFailedMessagePayload(message, jid);
      if (payload) {out.push(payload);}
    }
  }
  return out;
}

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
    !type.startsWith('roomHeapStore/') &&
    !type.startsWith('chat/setUser') &&
    !type.startsWith('chat/updateUser') &&
    !type.startsWith('chat/refreshTokens') &&
    !type.startsWith('chat/logout')
  ) {
    return result;
  }

  if (writeTimer) {clearTimeout(writeTimer);}
  writeTimer = setTimeout(() => {
    (async () => {
      try {
        const state = storeAPI.getState();
        const chatPayload: PersistedChatState = {
          user: sanitizeUser(state.chatSettingStore?.user) as User,
        };
        const roomsPayload: PersistedRoomsState = {
          rooms: sanitizeRooms(state.rooms?.rooms || {}),
        };
        const heapPayload: PersistedHeapState = {
          failedMessages: sanitizeFailedMessages(
            state.roomHeapSlice?.failedMessages
          ),
        };
        const [chatCipher, roomsCipher, heapCipher] = await Promise.all([
          encryptForPersist(JSON.stringify(chatPayload)),
          encryptForPersist(JSON.stringify(roomsPayload)),
          encryptForPersist(JSON.stringify(heapPayload)),
        ]);
        await AsyncStorage.multiSet([
          [KEY_CHAT, chatCipher],
          [KEY_ROOMS, roomsCipher],
          [KEY_HEAP, heapCipher],
        ]);
      } catch (e) {
        console.warn('persist write failed', e);
      }
    })();
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
  heap: PersistedHeapState | null;
}> {
  try {
    const [chatRaw, roomsRaw, heapRaw] = await AsyncStorage.multiGet([
      KEY_CHAT,
      KEY_ROOMS,
      KEY_HEAP,
    ]);
    const [chatPlain, roomsPlain, heapPlain] = await Promise.all([
      chatRaw[1] ? decryptFromPersist(chatRaw[1]) : Promise.resolve(null),
      roomsRaw[1] ? decryptFromPersist(roomsRaw[1]) : Promise.resolve(null),
      heapRaw[1] ? decryptFromPersist(heapRaw[1]) : Promise.resolve(null),
    ]);
    // `decryptFromPersist` returns null both for "nothing stored" and
    // for "stored value isn't a valid envelope for the current key" —
    // notably a plaintext blob left over from a pre-encryption install.
    // Either way there is nothing safe to parse, so the caller treats it
    // as a cold start and re-hydrates from the server.
    const chat = chatPlain ? (JSON.parse(chatPlain) as PersistedChatState) : null;
    const rooms = roomsPlain
      ? (JSON.parse(roomsPlain) as PersistedRoomsState)
      : null;
    const heap = heapPlain
      ? (JSON.parse(heapPlain) as PersistedHeapState)
      : null;
    return { chat, rooms, heap };
  } catch (e) {
    console.warn('persist read failed', e);
    return { chat: null, rooms: null, heap: null };
  }
}

export async function clearPersistedState(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY_CHAT, KEY_ROOMS, KEY_HEAP]);
  } catch (e) {
    console.warn('persist clear failed', e);
  }
}

export const PERSIST_KEYS = { KEY_CHAT, KEY_ROOMS, KEY_HEAP };
