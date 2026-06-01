import { createAsyncThunk, createSlice, PayloadAction, type Slice } from '@reduxjs/toolkit';
import type { WritableDraft } from 'immer';
import { EditAction, HistoryPreloadState, IMessage, IRoom } from '../types/types';
import { insertMessageWithDelimiter } from '../helpers/insertMessageWithDelimiter';
import type XmppClient from '../networking/xmppClient';

// Per-room runtime message cap. Mirrors the persistence layer's
// MESSAGE_LIMIT so what's in memory matches what's on disk; otherwise
// long sessions grow the array unbounded (memory leak) and reload
// shows fewer messages than the user saw last in the session.
//
// The cap fires on the APPEND path (new messages arriving) — paginated
// older history added via unshift/splice is exempt, so the user can
// page backward arbitrarily far without instantly losing what they
// just fetched. After cap eviction we drop from the head (oldest).
const RUNTIME_MESSAGE_LIMIT = 100;

const enforceMessageCap = (messages: IMessage[]): void => {
  // Trim oldest until we're at/under the limit. Mutates in place
  // (immer-compatible inside reducers).
  while (messages.length > RUNTIME_MESSAGE_LIMIT) {
    messages.shift();
  }
};

// Merge a freshly-fetched recent history page into a room's cached
// messages instead of REPLACING them — so re-entering the app no longer
// wipes older history (and the unread derived from it). Mirrors the web
// SDK's incremental sync:
//   • union + dedupe by message id (the server-authoritative,
//     microsecond-resolution stanza id) — overlapping messages collapse
//     and older cached history is kept;
//   • if the fetched page shares NO id with the cache, a gap has opened
//     (more than a page of new messages arrived while away) and stitching
//     them would leave a hole — so we clear THIS chat's cache and keep
//     just the fresh page;
//   • locally-pending (optimistic) sends are always preserved;
//   • an empty fetch leaves the cache untouched (the old replace wiped it);
//   • the transient 'delimiter-new' marker is dropped (the realtime insert
//     path re-derives it) so it can't mis-sort.
// `function` (hoisted) so the reducers above can call it regardless of
// where it sits in the file. msgSortableMs (defined below) is referenced
// at call time, after module init.
function mergeHistoryIntoCache(
  existing: IMessage[] | undefined,
  fetched: IMessage[] | undefined
): IMessage[] {
  const ex = Array.isArray(existing) ? existing : [];
  const fe = Array.isArray(fetched) ? fetched : [];

  const pending = ex.filter((m) => m?.pending);
  const realExisting = ex.filter(
    (m) => m && !m.pending && m.id !== 'delimiter-new'
  );
  const realFetched = fe.filter((m) => m && m.id !== 'delimiter-new');

  // Nothing usable came back → keep the cache exactly as it was.
  if (realFetched.length === 0) {return ex;}

  const byMs = (a: IMessage, b: IMessage) =>
    msgSortableMs(a) - msgSortableMs(b);
  const capTail = (arr: IMessage[]) =>
    arr.length > RUNTIME_MESSAGE_LIMIT
      ? arr.slice(-RUNTIME_MESSAGE_LIMIT)
      : arr;

  const existingIds = new Set(realExisting.map((m) => String(m.id)));
  const overlaps = realFetched.some((m) => existingIds.has(String(m.id)));

  // Cold room, or a gap (no shared id) → can't merge → use the fresh page.
  if (realExisting.length === 0 || !overlaps) {
    return [...capTail(realFetched.slice().sort(byMs)), ...pending];
  }

  // Overlap → union + dedupe by id. Fetched wins on collision: it carries
  // the freshest server state (reactions / edits / deletions).
  const byId = new Map<string, IMessage>();
  for (const m of realExisting) {byId.set(String(m.id), m);}
  for (const m of realFetched) {byId.set(String(m.id), m);}
  const merged = Array.from(byId.values()).sort(byMs);
  return [...capTail(merged), ...pending];
}

export interface RoomPreloadPatch {
  jid: string;
  messages?: IMessage[];
  historyPreloadState?: HistoryPreloadState;
  unreadCapped?: boolean;
  historyComplete?: boolean;
}

export interface RoomMessagesState {
  rooms: { [jid: string]: IRoom };
  activeRoomJID: string | null;
  visibleRoomJID: string | null;
  editAction?: EditAction;
  isLoading: boolean;
  loadingText?: string;
  usersSet?: Record<string, any>;
  pendingNotificationJid?: string | null;
}

const initialState: RoomMessagesState = {
  rooms: {},
  activeRoomJID: null,
  visibleRoomJID: null,
  isLoading: false,
  editAction: {
    isEdit: false,
    roomJid: '',
    messageId: '',
    text: '',
  },
  pendingNotificationJid: null,
};

const isValidRoomJid = (jid: unknown): jid is string => {
  if (typeof jid !== 'string' || !jid) return false;
  if (!jid.includes('@')) return false;
  return true;
};

export const addRoomViaApi = createAsyncThunk(
  'roomMessages/addRoomViaApi',
  async (
    { room, xmpp: _xmpp }: { room: IRoom; xmpp: XmppClient },
    { dispatch }
  ) => {
    if (!room || !room.jid) return;
    dispatch(roomsStore.actions.addRoomFromApi({ room }));
  }
);

// Reducers extracted so the slice can carry an explicit
// Slice<State, typeof reducers, Name> annotation, which prevents tsc
// from inlining immer's internal WritableNonArrayDraft type into the
// emitted .d.ts (TS4023). See chatSettingsSlice.ts for the same pattern.
const reducers = {
  addRoom(state: WritableDraft<RoomMessagesState>, action: PayloadAction<{ roomData: IRoom }>) {
      const { roomData } = action.payload;
      const existing = state.rooms[roomData.jid];
      // Default-marker resolution (cold-start unread bug):
      //   1. Explicit value on the payload wins.
      //   2. Existing redux value wins (preserves persisted/hydrated
      //      markers when the privateStore pull lands before
      //      /chats/my).
      //   3. Otherwise, anchor to the *newest known message* in the
      //      payload — this marks everything currently in the room
      //      as "seen" but lets any NEWER incoming message count as
      //      unread. Previously this fell back to `Date.now()`, which
      //      stamped a future-leaning marker that hid genuinely-new
      //      messages received while the app was closed.
      //   4. If there are no messages at all yet, stamp `0` (=
      //      "unknown — let the privateStore hydration set the real
      //      marker before any future message arrives").
      let lastViewed: number;
      // Treat an incoming `0` as "unset". stanzaHandlers' addRoom passes
      // `lastViewedTimestamp: 0` as a placeholder; the old `!= null` check
      // let that 0 win and OVERWROTE the persisted/hydrated marker from
      // the previous session, so cold-start showed no unread badge for
      // messages received while the app was closed (bug #19/#20). A real
      // (non-zero) explicit value still wins; otherwise keep the existing
      // value; otherwise anchor to the newest message in the payload.
      if (roomData.lastViewedTimestamp != null && roomData.lastViewedTimestamp !== 0) {
        lastViewed = roomData.lastViewedTimestamp;
      } else if (existing?.lastViewedTimestamp != null) {
        lastViewed = existing.lastViewedTimestamp;
      } else {
        const msgs = roomData.messages || [];
        let newest = 0;
        for (const m of msgs) {
          const t = (m as any)?.messageTimestampMs ||
            (m?.date ? new Date(m.date).getTime() : 0);
          if (t > newest) {newest = t;}
        }
        lastViewed = newest; // 0 if no messages → cold-start safe
      }
      // Preserve cached messages + unread when the incoming room carries
      // none. The /chats/my fetch (rooms.api) builds rooms with
      // `messages: []` and no unread; without this guard, re-entering the
      // app replaced every cached room with an empty one — wiping history
      // AND the unread badge before the history scheduler could re-merge
      // (the user's "it clears cache, unread and messages" bug). New rooms
      // (no existing) fall through to the incoming values. Mirrors
      // addRoomFromApi's preservation.
      const incomingMessages = Array.isArray(roomData.messages)
        ? roomData.messages
        : [];
      const existingMessages = Array.isArray(existing?.messages)
        ? existing!.messages
        : [];
      state.rooms[roomData.jid] = {
        ...roomData,
        messages:
          existingMessages.length > 0 ? existingMessages : incomingMessages,
        lastViewedTimestamp: lastViewed,
        unreadMessages:
          roomData.unreadMessages ?? existing?.unreadMessages ?? 0,
        unreadBaselineTimestamp:
          existing?.unreadBaselineTimestamp ??
          existing?.lastViewedTimestamp ??
          (roomData as any).unreadBaselineTimestamp ??
          0,
      };
    },
    deleteRoom(state: WritableDraft<RoomMessagesState>, action: PayloadAction<{ jid: string }>) {
      const { jid } = action.payload;
      if (state.rooms[jid]) {
        delete state.rooms[jid];
        if (state.visibleRoomJID === jid) {
          state.visibleRoomJID = null;
        }
      }
    },
    updateRoom(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ jid: string; updates: Partial<IRoom> }>
    ) {
      const { jid, updates } = action.payload;
      const existingRoom = state.rooms[jid];

      if (existingRoom) {
        state.rooms[jid] = {
          ...existingRoom,
          ...updates,
        };
      }
    },
    setRoomMessages(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string; messages: IMessage[] }>
    ) {
      const { roomJID, messages } = action.payload;
      if (state.rooms[roomJID]) {
        // Cap to the runtime limit on replace too — guards against a
        // single MAM page returning more than the limit (would balloon
        // the array on its own).
        const capped =
          messages.length > RUNTIME_MESSAGE_LIMIT
            ? messages.slice(-RUNTIME_MESSAGE_LIMIT)
            : messages;
        state.rooms[roomJID].messages = capped;
      }
    },
    deleteRoomMessage(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string; messageId: string }>
    ) {
      const { roomJID, messageId } = action.payload;
      if (state.rooms[roomJID]) {
        state.rooms[roomJID].messages.map((message) => {
          if (message.id === messageId) {
            message.isDeleted = true;
          }
        });
      }
    },
    setEditAction: (state: WritableDraft<RoomMessagesState>, action: PayloadAction<EditAction | undefined>) => {
      if (action.payload?.isEdit) {
        state.editAction = action.payload;
      } else {
        state.editAction = {
          isEdit: false,
          roomJid: '',
          messageId: '',
          text: '',
        };
      }
    },
    editRoomMessage(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        messageId: string;
        text: string;
      }>
    ) {
      const { roomJID, messageId, text } = action.payload;
      if (state.rooms[roomJID]) {
        state.rooms[roomJID].messages.map((message) => {
          if (message.id === messageId) {
            message.body = text;
          }
        });
      }
    },
    addRoomMessage(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        message: IMessage;
        start?: boolean;
      }>
    ) {
      const { roomJID, message, start } = action.payload;

      // Guard against the "stanza arrived before /chats/my completed"
      // race — without this, the optional-chain `?.messages` falls
      // back to undefined, and the assignment below tries to set
      // `.messages` on undefined → TypeError. Caller can safely
      // ignore the message; the room will get its messages array on
      // `addRoom` when the API response lands.
      if (!state.rooms[roomJID]) {
        return;
      }

      if (!state.rooms[roomJID].messages) {
        state.rooms[roomJID].messages = [];
      }

      const roomMessages = state.rooms[roomJID].messages;
      const lengthBefore = roomMessages.length;

      if (roomMessages.length === 0 || start) {
        roomMessages.unshift(message);
      } else {
        const lastViewedValue = state.rooms[roomJID].lastViewedTimestamp;
        const lastViewedTimestamp =
          state.visibleRoomJID === roomJID
            ? null
            : lastViewedValue
              ? new Date(lastViewedValue)
              : null;

        insertMessageWithDelimiter(roomMessages, message, lastViewedTimestamp);
      }

      // Apply the in-memory cap only when the array actually GREW
      // (i.e. this wasn't a dedupe/merge that left length unchanged).
      // Otherwise repeated echoes of the same message would chip away
      // at the oldest history for no reason.
      if (roomMessages.length > lengthBefore) {
        enforceMessageCap(roomMessages);
      }
    },
    deleteAllRooms(state: WritableDraft<RoomMessagesState>) {
      state.rooms = {};
      state.visibleRoomJID = null;
    },
    setComposing(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        chatJID: string;
        composing: boolean;
        composingList?: string[];
      }>
    ) {
      const { chatJID, composing, composingList } = action.payload;
      state.rooms[chatJID].composing = composing;
      state.rooms[chatJID].composingList = composingList;
    },
    setIsLoading: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID?: string; loading: boolean; loadingText?: string }>
    ) => {
      const { chatJID, loading, loadingText } = action.payload;
      if (chatJID && state.rooms?.[chatJID]) {
        state.rooms[chatJID].isLoading = loading;
      }
      state.isLoading = loading;
      state.loadingText = loadingText;
    },
    setLastViewedTimestamp: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID: string; timestamp: number }>
    ) => {
      const { chatJID, timestamp } = action.payload;
      if (state.rooms[chatJID]) {
        state.rooms[chatJID].lastViewedTimestamp = timestamp;
        // A non-positive timestamp means "no persisted marker yet" and
        // must not inflate unread from history that predates the first
        // successful private-store hydration. The visible-room state is
        // tracked separately via `visibleRoomJID`; no read/unread meaning
        // is encoded in the timestamp itself anymore.
        if (!(timestamp > 0)) {
          state.rooms[chatJID].unreadMessages = 0;
        } else {
          state.rooms[chatJID].unreadMessages = countNewerMessages(
            state.rooms[chatJID].messages,
            timestamp
          );
        }
      }
    },
    setRoomRole: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID: string; role: string }>
    ) => {
      const { chatJID, role } = action.payload;
      if (state.rooms[chatJID]) {
        state.rooms[chatJID].role = role;
      }
    },
    setRoomNoMessages: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ value: boolean; chatJID?: string }>
    ) => {
      const { value, chatJID } = action.payload;
      if (chatJID) {
        state.rooms[chatJID].noMessages = value;
      }
    },
    setCurrentRoom: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string | null }>
    ) => {
      // Accept null/empty so callers can clear the active room (e.g.
      // back button from chat → return to RoomList). Mirrors web.
      state.activeRoomJID = action.payload.roomJID || '';
    },
    setVisibleRoom: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string | null }>
    ) => {
      state.visibleRoomJID = action.payload.roomJID || null;
      const jid = state.visibleRoomJID;
      if (jid && state.rooms[jid]) {
        state.rooms[jid].unreadMessages = 0;
      }
    },
    clearVisibleRoom: (state: WritableDraft<RoomMessagesState>) => {
      state.visibleRoomJID = null;
    },
    /**
     * Stash a JID that a push notification asked us to open before
     * the rooms list has loaded. The Chat component clears this once
     * the room exists locally and dispatches `setCurrentRoom`.
     */
    setPendingNotificationJid: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<string | null>
    ) => {
      state.pendingNotificationJid = action.payload;
    },
    clearPendingNotificationJid: (state: WritableDraft<RoomMessagesState>) => {
      state.pendingNotificationJid = null;
    },
    /**
     * Stamp a message in `state.rooms[roomJID].messages` with an updated
     * reactions list. The reactionsMiddleware listens for this action to
     * keep `IRoom.lastMessage` / `lastMessageTimestamp` in sync.
     */
    setReactions: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        messageId: string;
        from?: string;
        reactions: string[];
        latestReactionTimestamp?: string;
        data?: Record<string, string>;
      }>
    ) => {
      const { roomJID, messageId, reactions } = action.payload;
      const room = state.rooms[roomJID];
      if (!room?.messages) {return;}
      for (const msg of room.messages) {
        if (msg?.id === messageId) {
          (msg as any).reactions = reactions;
          break;
        }
      }
    },
    setLogoutState: (state: WritableDraft<RoomMessagesState>) => {
      state.rooms = {};
      state.activeRoomJID = null;
      state.visibleRoomJID = null;
      state.isLoading = false;
    },
    setActiveMessage: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ id: string; chatJID: string }>
    ) => {
      const { id, chatJID } = action.payload;

      state.rooms[chatJID].messages.map((message) => {
        if (message.id === id) {
          message.activeMessage = true;
        } else {
          message.activeMessage = false;
        }
      });
    },
    setCloseActiveMessage: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID: string }>
    ) => {
      const { chatJID } = action.payload;

      state.rooms[chatJID].messages.map((message) => {
        message.activeMessage = false;
      });
    },
    /**
     * Batched update used by the history preload scheduler. Each patch is
     * applied to its room: messages REPLACE (when provided), state fields
     * MERGE. Rooms that don't exist yet are ignored.
     */
    addRoomFromApi: (state: WritableDraft<RoomMessagesState>, action: PayloadAction<{ room: IRoom }>) => {
      const { room } = action.payload;
      if (!isValidRoomJid(room?.jid)) return;
      const existing = state.rooms[room.jid];
      const incomingMessages = Array.isArray(room.messages)
        ? room.messages
        : [];
      const existingMessages = Array.isArray(existing?.messages)
        ? existing!.messages
        : [];
      state.rooms[room.jid] = {
        ...existing,
        ...room,
        title: room.title || existing?.title || room.title,
        usersCnt: (() => {
          const incoming =
            typeof room.usersCnt === 'number' && room.usersCnt > 0
              ? room.usersCnt
              : 0;
          const previous =
            typeof existing?.usersCnt === 'number' && existing.usersCnt > 0
              ? existing.usersCnt
              : 0;
          if (incoming === 0 && previous === 0) return room.usersCnt;
          return Math.max(incoming, previous);
        })(),
        icon: room.icon ?? existing?.icon,
        messages:
          existingMessages.length > 0 ? existingMessages : incomingMessages,
        unreadMessages: existing?.unreadMessages ?? room.unreadMessages ?? 0,
        lastViewedTimestamp:
          existing?.lastViewedTimestamp ?? room.lastViewedTimestamp ?? 0,
        unreadBaselineTimestamp:
          existing?.unreadBaselineTimestamp ??
          existing?.lastViewedTimestamp ??
          room.unreadBaselineTimestamp ??
          room.lastViewedTimestamp ??
          0,
        composingList: existing?.composingList ?? room.composingList,
        composing: existing?.composing ?? room.composing,
        unreadCapped: existing?.unreadCapped ?? room.unreadCapped ?? false,
        historyPreloadState:
          existing?.historyPreloadState ?? room.historyPreloadState ?? 'idle',
        messageStats: existing?.messageStats ?? room.messageStats,
        historyComplete: existing?.historyComplete ?? room.historyComplete,
      };
    },
    applyRoomsPreloadBatch: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ rooms: RoomPreloadPatch[] }>
    ) => {
      const { rooms } = action.payload;
      for (const patch of rooms) {
        const room = state.rooms[patch.jid];
        if (!room) {continue;}
        if (typeof patch.historyPreloadState !== 'undefined') {
          room.historyPreloadState = patch.historyPreloadState;
        }
        if (typeof patch.unreadCapped !== 'undefined') {
          room.unreadCapped = patch.unreadCapped;
        }
        if (typeof patch.historyComplete !== 'undefined') {
          room.historyComplete = patch.historyComplete;
        }
        if (Array.isArray(patch.messages)) {
          // Merge the fetched page into cache by message id rather than
          // replacing — preserves older history + unread on re-entry. Only
          // a true gap (no overlapping id) clears this chat's cache. See
          // mergeHistoryIntoCache.
          room.messages = mergeHistoryIntoCache(room.messages, patch.messages);
        }
      }
    },
};

export const roomsStore: Slice<RoomMessagesState, typeof reducers, 'roomMessages'> = createSlice({
  name: 'roomMessages',
  initialState,
  reducers,
});

// Count messages strictly newer than the given millisecond timestamp.
// Uses `msg.id` (server-authoritative microsecond timestamp prefixed by
// 13-digit millis — see helpers/dateComparison `getHighResolutionTimestamp`)
// because `msg.date` can be derived client-side (createMessageFromXml
// falls back to `Date.now()` for realtime stanzas without a `date`
// attr), which makes the comparison drift vs what the server assigned.
// Excludes the "delimiter-new" sentinel, pending sends, and the current
// user's own messages (parity with unreadMiddleware's isOwnMessage
// filter — without this, the reducer and the middleware disagree about
// the count and we get a flicker as the badge gets written twice with
// different values on every message).
export const msgSortableMs = (msg: any): number => {
  const id = String(msg?.id || '');
  const m = /^(\d{13})/.exec(id);
  if (m) {return Number(m[1]);}
  if (msg?.date) {
    const t = new Date(msg.date as any).getTime();
    if (Number.isFinite(t)) {return t;}
  }
  return 0;
};

const norm = (s: any): string => {
  if (s == null) {return '';}
  let v = String(s).toLowerCase();
  v = v.split('/')[0];
  v = v.split('@')[0];
  return v.replace(/_/g, '');
};

const isOwn = (
  msg: IMessage,
  selfXmpp: string,
  selfWallet: string
): boolean => {
  if (!selfXmpp && !selfWallet) {return false;}
  const candidates = [
    norm((msg as any)?.user?.id),
    norm((msg as any)?.user?.userJID),
    norm((msg as any)?.user?.xmppUsername),
    norm((msg as any)?.xmppFrom),
  ].filter(Boolean);
  if (candidates.length === 0) {return false;}
  const self = new Set(
    [norm(selfXmpp), norm(selfWallet)].filter(Boolean)
  );
  for (const c of candidates) {
    if (self.has(c)) {return true;}
  }
  return false;
};

const countNewerMessages = (
  messages: IMessage[],
  timestamp: number,
  selfXmpp: string = '',
  selfWallet: string = ''
): number => {
  if (!messages?.length || !timestamp) {return 0;}
  let count = 0;
  for (const message of messages) {
    if (!message || message.id === 'delimiter-new' || message.pending) {continue;}
    if (isOwn(message, selfXmpp, selfWallet)) {continue;}
    const ms = msgSortableMs(message);
    if (Number.isFinite(ms) && ms > timestamp) {count += 1;}
  }
  return count;
};

export const {
  addRoom,
  deleteAllRooms,
  setRoomMessages,
  addRoomMessage,
  deleteRoomMessage,
  setEditAction,
  editRoomMessage,
  setComposing,
  setIsLoading,
  setLastViewedTimestamp,
  setRoomNoMessages,
  setCurrentRoom,
  setVisibleRoom,
  clearVisibleRoom,
  setRoomRole,
  setLogoutState,
  setActiveMessage,
  setCloseActiveMessage,
  deleteRoom,
  updateRoom,
  applyRoomsPreloadBatch,
  setPendingNotificationJid,
  clearPendingNotificationJid,
  setReactions,
} = roomsStore.actions;

export default roomsStore.reducer;
