import { Middleware } from '@reduxjs/toolkit';
import { IMessage, IRoom, User } from '../types/types';
import type { FailedMessagePayload } from './roomHeapSlice';
import {
  getPersistBackend,
  legacyAsyncStorageBackend,
  type PersistBackend,
} from './persistBackend';

// -------------------------------------------------------------------
// Lightweight RN persistence layer. Mirrors what redux-persist gives
// the web component:
//
//   - persist chatSettingStore.user (sanitized) and rooms state
//   - blacklist transient fields (modals, activeRoomJID, etc.)
//   - cap each room's messages to the most recent MESSAGE_LIMIT (100)
//   - debounced writes (1 s, at most 4 s apart) of the rooms that changed
//
// Encrypted at rest either way (see `persistBackend.ts`): natively by
// MMKV when the host ships it, otherwise AES-256-CBC through crypto-js
// into AsyncStorage. `user` here is already secret-free (see
// `sanitizeUser`) — the encryption is for the message bodies in `rooms`,
// which aren't.
// -------------------------------------------------------------------

const PERSIST_PREFIX = '@ethora/persist:';
const KEY_CHAT = '@ethora/persist:chatSettingStore';
const KEY_ROOMS = '@ethora/persist:rooms';
const KEY_ROOM_INDEX = '@ethora/persist:roomIndex';
const KEY_ROOM_PREFIX = '@ethora/persist:room:';
const roomKey = (jid: string) => `${KEY_ROOM_PREFIX}${jid}`;
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
  // `translations` MUST be here. A previous version of this list dropped
  // it, on the theory that it mirrored the web SDK's persist contract —
  // it doesn't: web's redux-persist config (web/src/roomStore/index.ts)
  // has no per-field message whitelist at all, it persists whatever is in
  // `room.messages` (capped to the last 50) and that includes
  // `translations` verbatim. Field-picking is an RN-only mechanism, so
  // "same as web" was never true for this key.
  //
  // Dropping it meant every cold start painted the cached transcript in
  // the ORIGINAL language and only flipped to the translation once MAM
  // re-sent the history a few seconds later (onMessageHistory re-parses
  // <translations> off the wire) — visible on every launch, for every
  // translated message, since the cache never had a translation to show
  // in the first place. Persisting it here is what lets the very first
  // paint already be translated, the way the live path already is.
  'translations',
  'callLog',
  // bug #39: without this, a message that was still in flight (no
  // server echo yet) at kill time comes back from disk indistinguishable
  // from a normal delivered message, so the bubble renders it as sent.
  // Persisting `pending` lets the boot-time scan (see
  // computeBootTimeFailures below) find exactly the messages that never
  // got confirmed and flip them to failed instead.
  'pending',
  'unencrypted',
  'undecryptable',
  'e2eeError',
  'clientEncrypted',
  'e2eeKeys',
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
const PERSISTED_ROOM_MEMBERS = 30;

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
    // The same reasoning, one size down: the full roster a room gets once
    // it is opened (loadRoomMembers) is re-fetched on the next open, so only
    // the preview-sized head of it is worth a place in the cache.
    if (
      Array.isArray(compactRoom.roomMembers) &&
      compactRoom.roomMembers.length > PERSISTED_ROOM_MEMBERS
    ) {
      compactRoom.roomMembers = compactRoom.roomMembers.slice(0, PERSISTED_ROOM_MEMBERS);
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

type RoomTouch = (payload: any) => string[] | 'all';
const asList = (v: unknown): string[] =>
  typeof v === 'string' && v ? [v] : [];

const ROOM_ACTIONS: Record<string, RoomTouch> = {
  'roomMessages/addRoom': (p) => asList(p?.roomData?.jid),
  'roomMessages/addRooms': (p) =>
    Array.isArray(p?.rooms) ? p.rooms.map((r: any) => r?.jid).filter(Boolean) : 'all',
  'roomMessages/addRoomFromApi': (p) => asList(p?.room?.jid),
  'roomMessages/deleteRoom': (p) => asList(p?.jid),
  'roomMessages/updateRoom': (p) => asList(p?.jid),
  'roomMessages/setRoomMessages': (p) => asList(p?.roomJID),
  'roomMessages/deleteRoomMessage': (p) => asList(p?.roomJID),
  'roomMessages/editRoomMessage': (p) => asList(p?.roomJID),
  'roomMessages/addRoomMessage': (p) => asList(p?.roomJID),
  'roomMessages/addRoomMessages': (p) => asList(p?.roomJID),
  'roomMessages/setReactions': (p) => asList(p?.roomJID),
  'roomMessages/setLastViewedTimestamp': (p) => asList(p?.chatJID),
  'roomMessages/setRoomRole': (p) => asList(p?.chatJID),
  'roomMessages/setRoomNoMessages': (p) => asList(p?.chatJID),
  'roomMessages/setUnreadCounts': (p) =>
    p && typeof p === 'object' ? Object.keys(p) : 'all',
  'roomMessages/applyRoomsPreloadBatch': (p) =>
    Array.isArray(p?.rooms) ? p.rooms.map((r: any) => r?.jid).filter(Boolean) : 'all',
  'roomMessages/applyPrivateStoreMarkers': () => 'all',
  'roomMessages/deleteAllRooms': () => 'all',
  'roomMessages/setLogoutState': () => 'all',
};

const TRANSIENT_ROOM_ACTIONS = new Set([
  'roomMessages/setComposing',
  'roomMessages/setIsLoading',
  'roomMessages/setUnreadSyncing',
  'roomMessages/setCurrentRoom',
  'roomMessages/setVisibleRoom',
  'roomMessages/clearVisibleRoom',
  'roomMessages/setPendingNotificationJid',
  'roomMessages/clearPendingNotificationJid',
  'roomMessages/setActiveMessage',
  'roomMessages/setCloseActiveMessage',
  'roomMessages/setEditAction',
  'roomMessages/setReadBoundary',
  'roomMessages/clearReadBoundary',
  'roomMessages/setLoadingText',
  'roomMessages/mergeUsersSet',
]);

const roomsTouchedBy = (action: any): string[] | 'all' | null => {
  const type: string = action?.type || '';
  const touch = ROOM_ACTIONS[type];
  if (touch) {return touch(action?.payload);}
  if (!type.startsWith('roomMessages/')) {return null;}
  if (TRANSIENT_ROOM_ACTIONS.has(type)) {return null;}
  return 'all';
};

const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 4000;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt = 0;
let dirtyRooms = new Set<string>();
let allRoomsDirty = false;
let chatDirty = false;
let heapDirty = false;
let knownRoomJids = new Set<string>();
let legacyBlobPresent = false;
let migrateFromAsyncStorage = false;
let writeChain: Promise<void> = Promise.resolve();

const schedule = (flush: () => void) => {
  const now = Date.now();
  if (!firstPendingAt) {firstPendingAt = now;}
  if (writeTimer) {clearTimeout(writeTimer);}
  const remaining = Math.max(0, firstPendingAt + MAX_WAIT_MS - now);
  writeTimer = setTimeout(flush, Math.min(DEBOUNCE_MS, remaining));
};

const persistedRoom = (jid: string, room: IRoom | undefined) => {
  const clean = sanitizeRooms(room ? { [jid]: room } : {});
  return clean[jid];
};

async function writePending(getState: () => any): Promise<void> {
  const backend = await getPersistBackend();
  const rooms = dirtyRooms;
  const all = allRoomsDirty;
  const writeChat = chatDirty;
  const writeHeap = heapDirty;
  dirtyRooms = new Set();
  allRoomsDirty = false;
  chatDirty = false;
  heapDirty = false;

  const state = getState();
  const sets: [string, string][] = [];
  const removes: string[] = [];

  if (writeChat) {
    const chatPayload: PersistedChatState = {
      user: sanitizeUser(state.chatSettingStore?.user) as User,
    };
    sets.push([KEY_CHAT, JSON.stringify(chatPayload)]);
  }
  if (writeHeap) {
    const heapPayload: PersistedHeapState = {
      failedMessages: sanitizeFailedMessages(
        state.roomHeapSlice?.failedMessages
      ),
    };
    sets.push([KEY_HEAP, JSON.stringify(heapPayload)]);
  }

  const liveRooms: Record<string, IRoom> = state.rooms?.rooms || {};
  const jids = all
    ? new Set<string>([...Object.keys(liveRooms), ...knownRoomJids])
    : rooms;
  const nextKnown = new Set(knownRoomJids);
  for (const jid of jids) {
    const clean = persistedRoom(jid, liveRooms[jid]);
    if (clean) {
      sets.push([roomKey(jid), JSON.stringify(clean)]);
      nextKnown.add(jid);
    } else if (knownRoomJids.has(jid)) {
      removes.push(roomKey(jid));
      nextKnown.delete(jid);
    }
  }
  if (jids.size > 0 || legacyBlobPresent) {
    sets.push([KEY_ROOM_INDEX, JSON.stringify({ jids: [...nextKnown] })]);
  }
  if (legacyBlobPresent) {
    removes.push(KEY_ROOMS);
    legacyBlobPresent = false;
  }

  if (sets.length) {await backend.setMany(sets);}
  if (removes.length) {await backend.removeMany(removes);}
  knownRoomJids = nextKnown;

  if (migrateFromAsyncStorage && backend.name === 'mmkv') {
    migrateFromAsyncStorage = false;
    const old = (await legacyAsyncStorageBackend.allKeys()).filter((k) =>
      k.startsWith(PERSIST_PREFIX)
    );
    if (old.length) {await legacyAsyncStorageBackend.removeMany(old);}
  }
}

/**
 * Middleware that debounces writes of the persisted slices to AsyncStorage.
 * Only the slices — and only the rooms — an action actually changed are
 * written.
 */
export const persistenceMiddleware: Middleware = (storeAPI) => (next) => (
  action: any
) => {
  const result = next(action);

  const type: string = action?.type || '';
  let touched = false;
  if (type.startsWith('roomHeapStore/')) {
    heapDirty = true;
    touched = true;
  } else if (
    type.startsWith('chat/setUser') ||
    type.startsWith('chat/updateUser') ||
    type.startsWith('chat/refreshTokens') ||
    type.startsWith('chat/logout')
  ) {
    chatDirty = true;
    touched = true;
  } else {
    const rooms = roomsTouchedBy(action);
    if (rooms === 'all') {
      allRoomsDirty = true;
      touched = true;
    } else if (rooms && rooms.length) {
      for (const jid of rooms) {dirtyRooms.add(jid);}
      touched = true;
    }
  }
  if (!touched) {return result;}

  schedule(() => {
    writeTimer = null;
    firstPendingAt = 0;
    writeChain = writeChain
      .then(() => writePending(storeAPI.getState))
      .catch((e) => console.warn('persist write failed', e));
  });

  return result;
};

/**
 * Read persisted slices from AsyncStorage. Called once at store creation;
 * we DON'T hydrate synchronously (AsyncStorage is async) — instead, the
 * caller dispatches rehydrate actions when the read resolves.
 */
async function readFrom(backend: PersistBackend): Promise<{
  chat: PersistedChatState | null;
  rooms: PersistedRoomsState | null;
  heap: PersistedHeapState | null;
  legacyBlob: boolean;
  empty: boolean;
}> {
  const [chatPlain, indexPlain, legacyPlain, heapPlain] = await backend.getMany([
    KEY_CHAT,
    KEY_ROOM_INDEX,
    KEY_ROOMS,
    KEY_HEAP,
  ]);

  const parse = <T>(plain: string | null): T | null => {
    if (!plain) {return null;}
    try {
      return JSON.parse(plain) as T;
    } catch {
      return null;
    }
  };
  const chat = parse<PersistedChatState>(chatPlain);
  const heap = parse<PersistedHeapState>(heapPlain);

  let rooms: PersistedRoomsState | null = null;
  let legacyBlob = false;
  const jids = parse<{ jids?: string[] }>(indexPlain)?.jids || [];
  if (jids.length) {
    const plains = await backend.getMany(jids.map(roomKey));
    const out: Record<string, IRoom> = {};
    plains.forEach((plain, idx) => {
      const room = parse<IRoom>(plain);
      if (room) {out[jids[idx]] = room;}
    });
    rooms = { rooms: out };
  } else if (legacyPlain) {
    rooms = parse<PersistedRoomsState>(legacyPlain);
    legacyBlob = !!rooms;
  }
  return {
    chat,
    rooms,
    heap,
    legacyBlob,
    empty: !chat && !rooms && !heap,
  };
}

export async function readPersistedState(): Promise<{
  chat: PersistedChatState | null;
  rooms: PersistedRoomsState | null;
  heap: PersistedHeapState | null;
}> {
  try {
    const backend = await getPersistBackend();
    let read = await readFrom(backend);
    if (read.empty && backend.name === 'mmkv') {
      read = await readFrom(legacyAsyncStorageBackend);
      if (!read.empty) {
        migrateFromAsyncStorage = true;
        allRoomsDirty = true;
        chatDirty = !!read.chat;
        heapDirty = !!read.heap;
        knownRoomJids = new Set();
      }
    }
    if (read.legacyBlob) {
      legacyBlobPresent = true;
      allRoomsDirty = true;
      knownRoomJids = new Set();
    } else if (read.rooms && !migrateFromAsyncStorage) {
      knownRoomJids = new Set(Object.keys(read.rooms.rooms));
    }
    return { chat: read.chat, rooms: read.rooms, heap: read.heap };
  } catch (e) {
    console.warn('persist read failed', e);
    return { chat: null, rooms: null, heap: null };
  }
}

export async function clearPersistedState(): Promise<void> {
  try {
    const backend = await getPersistBackend();
    const targets: PersistBackend[] =
      backend.name === 'mmkv' ? [backend, legacyAsyncStorageBackend] : [backend];
    for (const target of targets) {
      const keys = (await target.allKeys()).filter((k) => k.startsWith(PERSIST_PREFIX));
      if (keys.length) {await target.removeMany(keys);}
    }
    knownRoomJids = new Set();
    dirtyRooms = new Set();
    legacyBlobPresent = false;
    migrateFromAsyncStorage = false;
  } catch (e) {
    console.warn('persist clear failed', e);
  }
}

export const PERSIST_KEYS = {
  KEY_CHAT,
  KEY_ROOMS,
  KEY_HEAP,
  KEY_ROOM_INDEX,
  KEY_ROOM_PREFIX,
};
export const persistedRoomKey = roomKey;
