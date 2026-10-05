import { createAsyncThunk, createSlice, PayloadAction, type Slice } from '@reduxjs/toolkit';
import type { WritableDraft } from 'immer';
import { EditAction, HistoryPreloadState, IMessage, IRoom } from '../types/types';
import { insertMessageWithDelimiter } from '../helpers/insertMessageWithDelimiter';
import { msgSortableMs } from '../helpers/msgSortableMs';
import type XmppClient from '../networking/xmppClient';
import type { TranslationObject } from '../helpers/transformTranslatations';
import { isSafeKey } from './safeKey';
import { mergeUsersSet as mergeIntoUsersSet } from './usersSetCap';
import { getRoomUserCount } from '../helpers/roomUserCount';

// Per-room runtime message cap. Mirrors the persistence layer's
// MESSAGE_LIMIT so what's in memory matches what's on disk; otherwise
// long sessions grow the array unbounded (memory leak) and reload
// shows fewer messages than the user saw last in the session.
//
// The cap fires on the APPEND path (new messages arriving) — paginated
// older history added via unshift/splice is exempt, so the user can
// page backward arbitrarily far without instantly losing what they
// just fetched. After cap eviction we drop from the head (oldest).
export const RUNTIME_MESSAGE_LIMIT = 100;

// Body strings the server uses for call signaling broadcasts (call-token,
// call-state ringing/ended, etc). These should never reach the chat
// transcript or the room-list "last message" preview, they're control
// frames, not user-visible content. The XMPP handler (onCallTokenMessage)
// already swallows them in the live stream, but they can still arrive via
// MAM history, mucsub catchup, or be present in persisted state from
// before that filter existed. Drop them at the reducer boundary so the
// transcript stays clean regardless of source.
const CALL_SIGNAL_BODIES = new Set([
  'call-token',
  'call-state',
  'call-ringing',
  'call-ended',
  'call-declined',
  'call-cancelled',
  'call-canceled',
  'call-timeout',
  'call-rejected',
  'call-invite',
]);

const isCallSignalMessage = (message: IMessage | undefined | null): boolean => {
  if (!message) {return false;}
  const body = String(message.body || '').trim().toLowerCase();
  return CALL_SIGNAL_BODIES.has(body);
};

const stripCallSignals = (messages: IMessage[] | undefined): IMessage[] =>
  Array.isArray(messages)
    ? messages.filter((message) => !isCallSignalMessage(message))
    : [];

// True for the client-side call-log fallback written at hangup: it exists
// only in this client's store (id "calllog-<callId>"), never on the server.
const isLocalCallLogEntry = (message: IMessage | undefined | null): boolean =>
  String(message?.id || '').startsWith('calllog-');

// Merge two log entries for the SAME callId into one. Identity (id/date/
// xmppId) comes from the server copy when one side is the local fallback,
// the server archive id is what MAM pages and the catch-up anchor will
// match against later. Display (body/callLog) comes from whichever copy
// saw the larger duration, so partial per-participant call-states don't
// shrink it.
const mergeCallLogEntries = (a: IMessage, b: IMessage): IMessage => {
  const aLocal = isLocalCallLogEntry(a);
  const bLocal = isLocalCallLogEntry(b);
  const identity = aLocal === bLocal ? a : aLocal ? b : a;
  const display =
    (a.callLog?.durationMs || 0) >= (b.callLog?.durationMs || 0) ? a : b;
  if (identity === display) {return identity;}
  return {
    ...display,
    id: identity.id,
    xmppId: identity.xmppId ?? display.xmppId,
    date: identity.date ?? display.date,
  };
};

// Collapse call-log duplicates for the same callId inside a merged history
// list (the live path dedups in addRoomMessage, but a MAM page merged over
// a persisted local fallback entry would otherwise show the call twice).
const collapseCallLogDuplicates = (messages: IMessage[]): IMessage[] => {
  const byCallId = new Map<string, IMessage>();
  let hasDuplicates = false;
  for (const message of messages) {
    const callId = message?.callLog?.callId;
    if (!callId) {continue;}
    const existing = byCallId.get(callId);
    if (existing) {
      hasDuplicates = true;
      byCallId.set(callId, mergeCallLogEntries(existing, message));
    } else {
      byCallId.set(callId, message);
    }
  }
  if (!hasDuplicates) {return messages;}
  const emitted = new Set<string>();
  return messages
    .filter((message) => {
      const callId = message?.callLog?.callId;
      if (!callId) {return true;}
      if (emitted.has(callId)) {return false;}
      emitted.add(callId);
      return true;
    })
    .map((message) => {
      const callId = message?.callLog?.callId;
      return callId ? byCallId.get(callId) || message : message;
    });
};

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
  // Strip call control frames on BOTH sides before merging: they can be
  // in the cache (persisted from before this filter existed) and in the
  // fetched MAM page (the live-stream swallow doesn't cover history).
  const ex = stripCallSignals(existing);
  const fe = stripCallSignals(fetched);

  const realExisting = ex.filter(
    (m) => m && !m.pending && m.id !== 'delimiter-new'
  );
  const realFetched = fe.filter((m) => m && m.id !== 'delimiter-new');

  // Nothing usable came back → keep the cache exactly as it was.
  if (realFetched.length === 0) {return ex;}

  // Optimistic sends are preserved across a history merge - EXCEPT the
  // ones the fetched page proves the server already has. That happens
  // whenever a send reached the server but its echo did not reach us
  // before the process died: the optimistic bubble is restored from disk
  // still `pending: true` (and, since bug #39, flagged failed at boot),
  // while MAM hands back the very same message under its ARCHIVE id.
  // Keying only on `id` never matched those two, so the room ended up
  // showing the message twice - once for real and once as a bubble stuck
  // on "sending…"/"Failed" that nothing could ever clear. The archived
  // copy carries our original stanza id as `xmppId` (getDataFromXml), so
  // match on that too and drop the local ghost.
  const fetchedKeys = new Set<string>();
  for (const m of realFetched) {
    if (m?.id != null) {fetchedKeys.add(String(m.id));}
    if ((m as any)?.xmppId) {fetchedKeys.add(String((m as any).xmppId));}
  }
  const pending = ex.filter(
    (m) =>
      m?.pending &&
      !fetchedKeys.has(String(m.id)) &&
      !(m.xmppId && fetchedKeys.has(String(m.xmppId)))
  );

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
    return [
      ...capTail(collapseCallLogDuplicates(realFetched.slice().sort(byMs))),
      ...pending,
    ];
  }

  // Overlap → union + dedupe by id. Fetched wins on collision: it carries
  // the freshest server state (reactions / edits / deletions).
  const byId = new Map<string, IMessage>();
  for (const m of realExisting) {byId.set(String(m.id), m);}
  for (const m of realFetched) {
    // Fetched wins on body/reactions/etc., but MAM doesn't carry our
    // client-side "edited" flag (the archived stanza just has the corrected
    // body). Preserve `isEdited` from the cached copy so a message edited
    // before reload keeps its marker instead of losing it on history sync.
    const prev = byId.get(String(m.id));
    byId.set(
      String(m.id),
      prev?.isEdited && !m.isEdited ? { ...m, isEdited: true } : m
    );
  }
  const merged = collapseCallLogDuplicates(
    Array.from(byId.values()).sort(byMs)
  );
  return [...capTail(merged), ...pending];
}

/** A message found in the archive that the chat cannot show in place. */
export interface ArchivedMessage {
  roomJID: string;
  sender: string;
  body: string;
  /** ISO timestamp from the archive. */
  createdAt: string;
}

/** A request to scroll a room's transcript to one message. */
export interface PendingJump {
  roomJID: string;
  /** Any id the message may be known by: message id, stanza id, xmpp id. */
  ids: string[];
  /**
   * For a message that has no usable id (search archive rows often carry
   * none): its timestamp and text, matched against the loaded transcript.
   */
  createdAt?: string;
  body?: string;
  /**
   * What to show if the message cannot be reached in the transcript: the hit
   * itself, so a tap on a search result always ends with the message on
   * screen rather than an error.
   */
  preview?: ArchivedMessage;
  /** Epoch ms the request was made, to drop one nobody ever fulfilled. */
  at: number;
}

/**
 * A short slice of a room's archive around one message, shown INSTEAD of the
 * live list while the reader is away from the tail (a search jump to a message
 * far back). Separate from room.messages on purpose: it is not contiguous with
 * the live history, so it must not touch messageStats or historyComplete.
 * Never persisted.
 */
export interface JumpWindow {
  roomJID: string;
  /** Ascending by time, like room.messages. */
  messages: IMessage[];
  /** Id of the message the jump named, as it appears in `messages`. */
  targetId: string;
  /** RSM cursor (microseconds) to continue older paging from. */
  olderCursor: number | null;
  hasOlder: boolean;
  /** RSM cursor (microseconds) to continue newer paging from. */
  newerCursor: number | null;
  hasNewer: boolean;
}

/** The window is trimmed on the far side past this many messages. */
export const JUMP_WINDOW_MAX_MESSAGES = 300;

const mergeWindowMessages = (a: IMessage[], b: IMessage[]): IMessage[] => {
  const seen = new Set<string>();
  const merged: IMessage[] = [];
  for (const message of [...a, ...b]) {
    const key = String(message.id);
    if (seen.has(key)) {continue;}
    seen.add(key);
    merged.push(message);
  }
  const num = (message: IMessage) => {
    const id = Number(message.id);
    return Number.isFinite(id) && id > 0
      ? id
      : new Date(message.date).getTime();
  };
  // Archive ids are microsecond stanza ids and ascending in time; fall back to
  // the date when an id is not numeric.
  return merged.sort((x, y) => num(x) - num(y));
};

export interface RoomPreloadPatch {
  jid: string;
  messages?: IMessage[];
  historyPreloadState?: HistoryPreloadState;
  unreadCapped?: boolean;
  historyComplete?: boolean;
  /**
   * RSM bounds of the loaded history (epoch ms or archive microseconds, the
   * same units the room already stores): merged into room.messageStats.
   */
  messageStats?: { firstMessageTimestamp?: number; lastMessageTimestamp?: number };
}

export interface RoomMessagesState {
  rooms: { [jid: string]: IRoom };
  activeRoomJID: string | null;
  visibleRoomJID: string | null;
  editAction?: EditAction;
  isLoading: boolean;
  loadingText?: string;
  isUnreadSyncing?: boolean;
  usersSet?: Record<string, any>;
  /** See JumpWindow. Never persisted. */
  jumpWindow: JumpWindow | null;
  /** See ArchivedMessage. Never persisted. */
  archivedMessage: ArchivedMessage | null;
  pendingNotificationJid?: string | null;
  // Server-side read markers fetched from the XMPP private store
  // (`{ roomJID: lastViewedMs }`). Kept here so a room that loads AFTER
  // the markers were fetched still inherits its baseline via `addRoom`
  // — see `applyPrivateStoreMarkers`. Re-fetched every init/reconnect,
  // so it is intentionally NOT persisted.
  privateStoreMarkers: Record<string, number>;
  // A pending "scroll this room's transcript to that message" request (a
  // message search hit, later a notification). Fulfilled by MessageList's
  // useJumpToMessage: scroll if mounted, else page older history until the
  // message shows up. `at` bounds how long a request may stay alive. Never
  // persisted (persistence.ts only picks `rooms`).
  pendingJump: PendingJump | null;
  // The room this session is joining right now (opened from the public chats
  // directory, a link or a QR code) which is not in the room list yet. The
  // server registers the membership a moment after our presence join, so
  // "not in the list" is not yet "unavailable": ChatRoom shows a loader while
  // this names the active room. Set and cleared by useRoomInitialization.
  // Never persisted.
  joiningRoomJID: string | null;
  // The single source of truth for "read up to here, but the user
  // hasn't reached the bottom yet" (`{ roomJID: boundaryMs }`).
  // Set by MessageList (via ChatRoom's `onReadBoundaryChange`) the
  // moment the user first scrolls away from the bottom, to the
  // msgSortableMs of the newest message they'd actually seen. Every
  // path that stamps a read marker for a room the user is leaving
  // (ChatRoom unmount, xmppProvider's AppState background handler and
  // `isVisible=false` handler, the live `advance()` effect, and
  // `useChatRoomFocus`'s `leaveRoom`) must consult this instead of
  // unconditionally stamping "the newest acked message" - otherwise
  // leaving a room while scrolled up marks messages the user never
  // reached as read (customer #42, a regression of #33 reintroduced by
  // #38's server-timestamp marker). See `getReadMarkerTimestamp` in
  // helpers/getServerReadTimestamp.ts.
  //
  // Cleared when the boundary no longer applies: the user scrolls back
  // to the bottom, the visible room changes, or the room is truly left
  // (ChatRoom unmounts, or a tab-navigator focus hook releases the
  // room). NOT cleared merely because the app backgrounds or a host's
  // `isVisible` flips false - MessageList typically stays mounted
  // through those, so its own scroll-tracking ref (the only thing that
  // could re-derive this value) is still intact and the boundary must
  // stay in sync with it. Deliberately NOT persisted (this key isn't
  // read by `persistence.ts`, which only ever picks `rooms` back out of
  // this slice) - it's meaningless across a process restart, where
  // MessageList always mounts fresh at the bottom.
  readBoundaries: Record<string, number>;
}

const initialState: RoomMessagesState = {
  rooms: {},
  activeRoomJID: null,
  visibleRoomJID: null,
  isLoading: false,
  isUnreadSyncing: false,
  editAction: {
    isEdit: false,
    roomJid: '',
    messageId: '',
    text: '',
  },
  pendingNotificationJid: null,
  privateStoreMarkers: {},
  pendingJump: null,
  joiningRoomJID: null,
  readBoundaries: {},
  usersSet: {},
  jumpWindow: null,
  archivedMessage: null,
};

const isValidRoomJid = (jid: unknown): jid is string => {
  if (!isSafeKey(jid)) {return false;}
  if (!jid.includes('@')) {return false;}
  return true;
};

/**
 * Visits every stored copy of one message: the live copy in
 * state.rooms[jid].messages and, when a jump window is open on that room, the
 * window's separate copy. The window is a second list of the same messages, so
 * every reducer that mutates ONE message must go through this or the reader
 * sees stale edits/reactions/delivery state while away from the live tail.
 * `matches` is an id, or a predicate when a reducer also matches on xmppId.
 */
const forEachMessageCopy = (
  state: RoomMessagesState,
  jid: string,
  matches: string | ((message: IMessage) => boolean),
  fn: (message: IMessage) => void
) => {
  const pred =
    typeof matches === 'function'
      ? matches
      : (message: IMessage) => message.id === matches;
  const live = state.rooms[jid]?.messages;
  if (Array.isArray(live)) {
    for (const message of live) {if (pred(message)) {fn(message);}}
  }
  const win = state.jumpWindow;
  if (win && win.roomJID === jid && Array.isArray(win.messages)) {
    for (const message of win.messages) {if (pred(message)) {fn(message);}}
  }
};

/**
 * usersCnt after a /chats/my refresh. The API reports the true total in
 * `usersCnt` but at most 30 `members` for a big room, so the members array
 * length is only a floor; and a count already known (a larger one from an
 * earlier response or a live join) is never lowered by a refresh.
 */
const resolveIncomingUsersCnt = (
  incoming: Pick<IRoom, 'members' | 'usersCnt'> & { participants?: number },
  existing: IRoom | undefined
): number => {
  const apiTotal =
    typeof incoming.usersCnt === 'number' && incoming.usersCnt > 0
      ? incoming.usersCnt
      : 0;
  const membersLen = Array.isArray(incoming.members)
    ? incoming.members.length
    : 0;
  const next = Math.max(apiTotal, membersLen);
  return Math.max(next, existing ? getRoomUserCount(existing) : 0);
};

/**
 * The server-reported unread snapshot of a room after an incoming /chats/my
 * item: the freshest API value wins while the user is not looking at the
 * room; one being read right now keeps none. Absent from the response =
 * keep what an earlier, richer response set.
 */
const resolveApiUnread = (
  state: RoomMessagesState,
  jid: string,
  incoming: Partial<IRoom>,
  existing: IRoom | undefined
): Pick<IRoom, 'apiUnreadCount' | 'apiUnreadSeededAt'> => {
  if (state.activeRoomJID === jid || state.visibleRoomJID === jid) {
    return { apiUnreadCount: undefined, apiUnreadSeededAt: undefined };
  }
  if (incoming.apiUnreadCount !== undefined) {
    return {
      apiUnreadCount: incoming.apiUnreadCount,
      apiUnreadSeededAt: incoming.apiUnreadSeededAt ?? Date.now(),
    };
  }
  return {
    apiUnreadCount: existing?.apiUnreadCount,
    apiUnreadSeededAt: existing?.apiUnreadSeededAt,
  };
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
      if (!isSafeKey(roomData?.jid)) {return;}
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
      // value; otherwise fall back to the server-side read marker fetched
      // from the private store (so a room the user has NEVER opened this
      // session still gets a real baseline — without it the unread
      // middleware's `lastViewedTimestamp > 0` gate skipped the room
      // forever and the badge never lit up); otherwise anchor to the
      // newest message in the payload.
      const serverMarker = state.privateStoreMarkers?.[roomData.jid] || 0;
      if (roomData.lastViewedTimestamp != null && roomData.lastViewedTimestamp !== 0) {
        lastViewed = roomData.lastViewedTimestamp;
      } else if (existing?.lastViewedTimestamp != null && existing.lastViewedTimestamp > 0) {
        lastViewed = existing.lastViewedTimestamp;
      } else if (serverMarker > 0) {
        lastViewed = serverMarker;
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
        usersCnt: resolveIncomingUsersCnt(roomData, existing),
        // A seed for the room-list preview: take the freshest API value but
        // never let a payload without one erase what is already there.
        lastMessage: roomData.lastMessage ?? existing?.lastMessage,
        ...resolveApiUnread(state, roomData.jid, roomData, existing),
        icon: roomData.icon !== undefined ? roomData.icon : existing?.icon,
        roomBg: roomData.roomBg !== undefined ? roomData.roomBg : existing?.roomBg,
        messages:
          existingMessages.length > 0 ? existingMessages : incomingMessages,
        lastViewedTimestamp: lastViewed,
        // A server-seeded count must not badge a room that is open right now.
        unreadMessages:
          roomData.apiUnreadCount !== undefined &&
          (state.activeRoomJID === roomData.jid ||
            state.visibleRoomJID === roomData.jid)
            ? existing?.unreadMessages ?? 0
            : roomData.unreadMessages ?? existing?.unreadMessages ?? 0,
        unreadBaselineTimestamp:
          existing?.unreadBaselineTimestamp ??
          existing?.lastViewedTimestamp ??
          (roomData as any).unreadBaselineTimestamp ??
          0,
      };
    },
    deleteRoom(state: WritableDraft<RoomMessagesState>, action: PayloadAction<{ jid: string }>) {
      const { jid } = action.payload;
      if (!isSafeKey(jid)) {return;}
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
      if (!isSafeKey(jid)) {return;}
      const existingRoom = state.rooms[jid];
      if (!existingRoom) {return;}

      const merged: IRoom = { ...existingRoom, ...updates };

      if (typeof updates.usersCnt === 'number') {
        // An explicit count (a live join or leave) is taken as given, with the
        // known members as a floor.
        const newMembers = Array.isArray(updates.members)
          ? updates.members
          : existingRoom.members;
        const floor = Array.isArray(newMembers) ? newMembers.length : 0;
        merged.usersCnt = Math.max(updates.usersCnt, floor);
      } else if (Array.isArray(updates.members)) {
        // A members-only refresh of a truncated big room (usersCnt > the
        // first page) must not collapse the true total to the page length.
        const prevMembers = Array.isArray(existingRoom.members)
          ? existingRoom.members.length
          : 0;
        const prevCnt =
          typeof existingRoom.usersCnt === 'number' ? existingRoom.usersCnt : 0;
        merged.usersCnt =
          prevCnt > prevMembers
            ? Math.max(prevCnt, updates.members.length)
            : updates.members.length;
      }
      state.rooms[jid] = merged;
    },
    setRoomMessages(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string; messages: IMessage[] }>
    ) {
      const { roomJID, messages } = action.payload;
      if (!isSafeKey(roomJID)) {return;}
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
      if (!isSafeKey(roomJID)) {return;}
      const room = state.rooms[roomJID];
      if (!room?.messages) {return;}
      // The "New messages" divider is a transient UI marker, not a real
      // message — SPLICE it out so it can be re-inserted for the next
      // unread batch. Marking it isDeleted (like a real message) left it in
      // the array, where insertMessageWithDelimiter's "already present"
      // guard then blocked every future divider (one-shot bug).
      if (messageId === 'delimiter-new') {
        const idx = room.messages.findIndex((m) => m.id === 'delimiter-new');
        if (idx !== -1) {room.messages.splice(idx, 1);}
        return;
      }
      forEachMessageCopy(state, roomJID, messageId, (message) => {
        message.isDeleted = true;
      });
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
      if (!isSafeKey(roomJID)) {return;}
      // Edited in place on every copy (live list and jump window).
      forEachMessageCopy(state, roomJID, messageId, (message) => {
        message.body = text;
        // Flag the correction so the bubble can render an "edited" marker.
        // Covers both the author's own edit and edits from other users -
        // every <replace> echo flows through here.
        message.isEdited = true;
      });
    },
    /**
     * Hard removal, unlike `deleteRoomMessage`'s tombstone. For optimistic
     * messages that never made it onto the wire.
     */
    removeRoomMessage(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string; messageId: string }>
    ) {
      const { roomJID, messageId } = action.payload;
      if (!isSafeKey(roomJID)) {return;}
      if (state.rooms[roomJID]?.messages) {
        state.rooms[roomJID].messages = state.rooms[roomJID].messages.filter(
          (message) => message.id !== messageId
        );
      }
      const win = state.jumpWindow;
      if (win && win.roomJID === roomJID) {
        win.messages = win.messages.filter(
          (message) => message.id !== messageId
        );
      }
    },
    /**
     * Caches one translation onto the message it belongs to, keyed by the
     * locale tag the translate service echoed back. Applied to the live
     * copy and the jump window's copy.
     */
    setMessageTranslation(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        messageId: string;
        locale: string;
        entry: TranslationObject[string];
      }>
    ) {
      const { roomJID, messageId, locale, entry } = action.payload;
      if (!isSafeKey(roomJID) || !isSafeKey(locale)) {return;}
      forEachMessageCopy(state, roomJID, messageId, (message) => {
        if (!message.translations) {message.translations = {};}
        message.translations[locale] = entry;
      });
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
      if (!isSafeKey(roomJID)) {return;}

      // Call signaling broadcasts ("call-token", "call-state", etc.)
      // sometimes slip past the live XMPP filter (MAM history, mucsub
      // catch-up), drop them here so they never land in the transcript
      // or the room-list "last message" preview.
      if (isCallSignalMessage(message)) {
        return;
      }

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

      // Collapse multiple call-state events for the same call into a single
      // log entry. Sources: the client-side fallback written at hangup (id
      // "calllog-<callId>", exists only locally) and the server broadcast(s),
      // which can fire once per participant leaving (earlier ones carry a
      // partial durationMs). Rules:
      //  - the SERVER copy is canonical for identity (id/date/xmppId): its
      //    archive id is what MAM and the catch-up anchor return later, so
      //    keeping a local "calllog-" id around breaks anchor matching and
      //    duplicates the entry on the next history merge;
      //  - the LARGEST duration wins for display, so a 2-minute call doesn't
      //    render as "2 sec".
      const incomingCallLog = message.callLog;
      if (incomingCallLog?.callId) {
        const existingCallIdx = roomMessages.findIndex(
          (msg) => msg.callLog?.callId === incomingCallLog.callId
        );
        if (existingCallIdx !== -1) {
          const existing = roomMessages[existingCallIdx];
          const merged = mergeCallLogEntries(existing as IMessage, message);
          if (merged !== (existing as IMessage)) {
            roomMessages[existingCallIdx] = merged;
          }
          const win = state.jumpWindow;
          if (win && win.roomJID === roomJID) {
            const wi = win.messages.findIndex(
              (msg) => msg.callLog?.callId === incomingCallLog.callId
            );
            if (wi !== -1) {
              const wExisting = win.messages[wi];
              const wMerged = mergeCallLogEntries(wExisting, message);
              if (wMerged !== wExisting) {win.messages[wi] = wMerged;}
            }
          }
          return;
        }
      }

      const lengthBefore = roomMessages.length;
      const isKnownMessage = (msg: IMessage) =>
        msg.id === message.id ||
        (!!message.xmppId && msg.id === message.xmppId) ||
        (!!msg.xmppId && msg.xmppId === message.id);

      if (roomMessages.length === 0 || start) {
        roomMessages.unshift(message);
      } else {
        const lastViewedValue = state.rooms[roomJID].lastViewedTimestamp;
        const lastViewedTimestamp =
          state.visibleRoomJID === roomJID
            ? null
            : lastViewedValue
              ? lastViewedValue
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

      // Keep the jump window's copy in step with the live list.
      const win = state.jumpWindow;
      if (win && win.roomJID === roomJID && win.messages.length > 0) {
        const wi = win.messages.findIndex(isKnownMessage);
        if (wi !== -1) {
          // The echo of a message the reader sees in the window: flips it
          // from "sending" to delivered there too.
          const prev = win.messages[wi];
          const next: Record<string, unknown> = { ...prev };
          for (const [key, value] of Object.entries(message)) {
            if (value !== undefined && isSafeKey(key)) {next[key] = value;}
          }
          // The sender identity captured on first insert wins, as in the
          // live list (the echo parses a different id form).
          next.user = prev.user;
          next.pending = false;
          win.messages[wi] = next as unknown as IMessage;
        } else if (!win.hasNewer && !start) {
          // A reader parked at the LIVE END of a window (hasNewer false: it
          // already reaches the tail) must see what arrives next, or the
          // window would silently go stale while the live list moves on. The
          // message is by definition the newest, so it is appended as-is.
          // While hasNewer is true the window is not adjacent to the tail and
          // the message waits in room.messages until the reader returns to
          // live.
          win.messages.push({ ...message });
          if (win.messages.length > JUMP_WINDOW_MAX_MESSAGES) {
            win.messages = win.messages.slice(-JUMP_WINDOW_MAX_MESSAGES);
            const oldest = Number(win.messages[0].id);
            win.olderCursor = Number.isFinite(oldest)
              ? oldest
              : win.olderCursor;
            win.hasOlder = true;
          }
        }
      }
    },
    deleteAllRooms(state: WritableDraft<RoomMessagesState>) {
      state.rooms = {};
      state.jumpWindow = null;
      state.visibleRoomJID = null;
      state.privateStoreMarkers = {};
      state.readBoundaries = {};
      state.isUnreadSyncing = false;
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
      if (!isSafeKey(chatJID) || !state.rooms[chatJID]) {return;}
      state.rooms[chatJID].composing = composing;
      state.rooms[chatJID].composingList = composingList;
    },
    setIsLoading: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID?: string; loading: boolean; loadingText?: string }>
    ) => {
      const { chatJID, loading, loadingText } = action.payload;
      if (isSafeKey(chatJID) && state.rooms?.[chatJID]) {
        state.rooms[chatJID].isLoading = loading;
      }
      state.isLoading = loading;
      state.loadingText = loadingText;
    },
    setUnreadSyncing: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<boolean>
    ) => {
      state.isUnreadSyncing = action.payload;
    },
    setLastViewedTimestamp: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID: string; timestamp: number }>
    ) => {
      const { chatJID, timestamp } = action.payload;
      if (isSafeKey(chatJID) && state.rooms[chatJID]) {
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
    /**
     * Apply server-side read markers fetched from the XMPP private store
     * (`{ roomJID: lastViewedMs }`) to redux. This is the hydration that
     * was missing: `getChatsPrivateStoreRequest` fetched the markers on
     * every init/reconnect and every caller then DISCARDED the result, so
     * rooms kept `lastViewedTimestamp: 0` and the unread middleware's
     * `> 0` gate skipped them forever — `useUnread()` stayed at 0 for any
     * room the user hadn't locally opened+left this session. Centralised
     * here (and consulted by `addRoom`) so BOTH already-loaded rooms and
     * rooms that load later pick up the baseline.
     *
     * Monotonic: a marker only ever moves a baseline FORWARD, so a stale
     * server value can't resurrect already-read messages and a more-recent
     * local read (tab blur stamping the server read timestamp) always wins.
     *
     * Bug #38 self-heal: forward-only is correct for a SANE existing
     * value, but a device whose clock was ahead may have already stamped
     * a marker in the future (either persisted locally from a previous
     * session, or fetched from the server before this fix existed). To
     * "only ever move forward" from a corrupt future value is to never
     * move at all - the room would stay stuck at `unreadMessages: 0`
     * forever. When the room is loaded, detect a marker that sits well
     * past the newest message we actually know it has and waive the
     * forward-only check for that one comparison, so the incoming
     * (already-clamped, see xmppClient.getChatsPrivateStoreRequestStanza)
     * value can correct it even though it's numerically smaller.
     */
    applyPrivateStoreMarkers: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<Record<string, number>>
    ) => {
      const markers = action.payload;
      if (!markers || typeof markers !== 'object') {return;}
      if (!state.privateStoreMarkers) {state.privateStoreMarkers = {};}
      for (const jid of Object.keys(markers)) {
        const ts = Number(markers[jid]);
        if (!isSafeKey(jid) || !Number.isFinite(ts) || ts <= 0) {continue;}

        const room = state.rooms[jid];
        const newestKnownMs = room ? newestAckedMessageMs(room.messages) : 0;
        // Mirrors isCorruptFutureReadMarker in helpers/getServerReadTimestamp.ts
        // (duplicated to avoid a roomStore <-> helpers import cycle):
        // BOTH signals are required. "Further ahead than the newest
        // message this room has locally" happens all the time on a room
        // whose history hasn't synced yet, and healing on that alone
        // would drop a legitimate marker another device wrote after
        // reading newer messages. A real read marker can never be ahead
        // of real time, so that second signal is what distinguishes a
        // stale cache from a wrong clock.
        const nowMs = Date.now();
        const looksCorrupt = (existing: number) =>
          newestKnownMs > 0 &&
          existing > newestKnownMs + FUTURE_MARKER_TOLERANCE_MS &&
          existing > nowMs + FUTURE_MARKER_TOLERANCE_MS;

        // Remember the marker so rooms that load LATER (via addRoom)
        // inherit it even though they don't exist in the store yet.
        const cachedMarker = state.privateStoreMarkers[jid] || 0;
        if (ts > cachedMarker || looksCorrupt(cachedMarker)) {
          state.privateStoreMarkers[jid] = ts;
        }
        // Upgrade an already-loaded room's baseline + recompute its badge.
        // Forward-only, unless the room's CURRENT baseline is itself the
        // corrupt value being corrected.
        if (room && (ts > (room.lastViewedTimestamp || 0) || looksCorrupt(room.lastViewedTimestamp || 0))) {
          room.lastViewedTimestamp = ts;
          room.unreadMessages = countNewerMessages(room.messages, ts);
        }
      }
    },
    /**
     * Set (or clear) the "read up to here, but not further" boundary for
     * a room - see `readBoundaries` on `RoomMessagesState` for the full
     * contract. `ts` is the msgSortableMs of the newest message the user
     * actually reached before scrolling away from the bottom; `null`/`0`
     * clears it (the user is at the bottom, or nothing was reached yet).
     */
    setReadBoundary: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ jid: string; ts: number | null }>
    ) => {
      const { jid, ts } = action.payload;
      if (!isSafeKey(jid)) {return;}
      if (!state.readBoundaries) {state.readBoundaries = {};}
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
        state.readBoundaries[jid] = ts;
      } else {
        delete state.readBoundaries[jid];
      }
    },
    /**
     * Release a room's read boundary once it has been consumed by a
     * genuine "leave" (ChatRoom unmount, or a tab-navigator focus hook
     * switching to a different room) - see `readBoundaries` for why the
     * background/`isVisible=false` paths deliberately do NOT call this.
     */
    clearReadBoundary: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ jid: string }>
    ) => {
      const { jid } = action.payload;
      if (isSafeKey(jid) && state.readBoundaries) {delete state.readBoundaries[jid];}
    },
    setRoomRole: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID: string; role: string }>
    ) => {
      const { chatJID, role } = action.payload;
      if (isSafeKey(chatJID) && state.rooms[chatJID]) {
        state.rooms[chatJID].role = role;
      }
    },
    setRoomNoMessages: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ value: boolean; chatJID?: string }>
    ) => {
      const { value, chatJID } = action.payload;
      if (isSafeKey(chatJID) && state.rooms[chatJID]) {
        state.rooms[chatJID].noMessages = value;
      }
    },
    setCurrentRoom: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string | null }>
    ) => {
      // Accept null/empty so callers can clear the active room (e.g.
      // back button from chat → return to RoomList). Mirrors web.
      const { roomJID } = action.payload;
      if (roomJID && !isSafeKey(roomJID)) {return;}
      state.activeRoomJID = roomJID || '';
      // Opening a room reads it: the server's earlier unread count no longer
      // applies (the unread middleware would otherwise bring it back the
      // moment the user leaves the room again).
      if (roomJID && state.rooms[roomJID]?.apiUnreadCount !== undefined) {
        state.rooms[roomJID].apiUnreadCount = undefined;
        state.rooms[roomJID].apiUnreadSeededAt = undefined;
        state.rooms[roomJID].unreadMessages = 0;
      }
    },
    setVisibleRoom: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ roomJID: string | null }>
    ) => {
      const requested = action.payload.roomJID;
      if (requested && !isSafeKey(requested)) {return;}
      state.visibleRoomJID = requested || null;
      const jid = state.visibleRoomJID;
      if (jid && state.rooms[jid]) {
        state.rooms[jid].unreadMessages = 0;
        state.rooms[jid].apiUnreadCount = undefined;
        state.rooms[jid].apiUnreadSeededAt = undefined;
      }
    },
    clearVisibleRoom: (state: WritableDraft<RoomMessagesState>) => {
      const jid = state.visibleRoomJID;
      state.visibleRoomJID = null;
   
      if (jid && state.rooms[jid]) {
        const room = state.rooms[jid];
        const t = room.lastViewedTimestamp || 0;
        room.unreadMessages = t > 0 ? countNewerMessages(room.messages, t) : 0;
      }
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
    requestJumpToMessage: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        ids: string[];
        createdAt?: string;
        body?: string;
        preview?: ArchivedMessage;
      }>
    ) => {
      const ids = action.payload.ids.filter(Boolean);
      const canMatchByContent = Boolean(
        action.payload.createdAt && action.payload.body
      );
      if (!action.payload.roomJID || (ids.length === 0 && !canMatchByContent)) {
        return;
      }
      state.pendingJump = {
        roomJID: action.payload.roomJID,
        ids,
        createdAt: action.payload.createdAt,
        body: action.payload.body,
        preview: action.payload.preview,
        at: Date.now(),
      };
    },
    clearPendingJump: (state: WritableDraft<RoomMessagesState>) => {
      state.pendingJump = null;
    },
    showArchivedMessage: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<ArchivedMessage>
    ) => {
      state.archivedMessage = action.payload;
    },
    clearArchivedMessage: (state: WritableDraft<RoomMessagesState>) => {
      state.archivedMessage = null;
    },
    setJumpWindow: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<JumpWindow>
    ) => {
      state.jumpWindow = {
        ...action.payload,
        messages: mergeWindowMessages(action.payload.messages, []),
      };
    },
    prependJumpWindowMessages: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        messages: IMessage[];
        olderCursor: number | null;
        hasOlder: boolean;
      }>
    ) => {
      const win = state.jumpWindow;
      if (!win || win.roomJID !== action.payload.roomJID) {return;}
      win.messages = mergeWindowMessages(action.payload.messages, win.messages);
      win.olderCursor = action.payload.olderCursor;
      win.hasOlder = action.payload.hasOlder;
      if (win.messages.length > JUMP_WINDOW_MAX_MESSAGES) {
        // Reader is going up: drop the far (newest) side and page it again if
        // they come back down.
        win.messages = win.messages.slice(0, JUMP_WINDOW_MAX_MESSAGES);
        const newest = Number(win.messages[win.messages.length - 1].id);
        win.newerCursor = Number.isFinite(newest) ? newest : win.newerCursor;
        win.hasNewer = true;
      }
    },
    appendJumpWindowMessages: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{
        roomJID: string;
        messages: IMessage[];
        newerCursor: number | null;
        hasNewer: boolean;
      }>
    ) => {
      const win = state.jumpWindow;
      if (!win || win.roomJID !== action.payload.roomJID) {return;}
      win.messages = mergeWindowMessages(win.messages, action.payload.messages);
      win.newerCursor = action.payload.newerCursor;
      win.hasNewer = action.payload.hasNewer;
      if (win.messages.length > JUMP_WINDOW_MAX_MESSAGES) {
        win.messages = win.messages.slice(-JUMP_WINDOW_MAX_MESSAGES);
        const oldest = Number(win.messages[0].id);
        win.olderCursor = Number.isFinite(oldest) ? oldest : win.olderCursor;
        win.hasOlder = true;
      }
    },
    clearJumpWindow: (state: WritableDraft<RoomMessagesState>) => {
      state.jumpWindow = null;
    },
    setJoiningRoom: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<string>
    ) => {
      state.joiningRoomJID = action.payload || null;
    },
    // Only clears when it still names that room, so a slow join for a room
    // the user already left cannot wipe the join of the current one.
    clearJoiningRoom: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<string>
    ) => {
      if (state.joiningRoomJID === action.payload) {
        state.joiningRoomJID = null;
      }
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
      const { roomJID, messageId, reactions, from, data } = action.payload;
      if (!isSafeKey(roomJID) || !from) {return;}
      const fromId = from.split('@')[0];
      // `fromId` becomes a property name on the message's reaction map.
      if (!isSafeKey(fromId)) {return;}
      forEachMessageCopy(state, roomJID, messageId, (message) => {
        if (!message.reaction) {message.reaction = {};}
        if (!Array.isArray(reactions) || reactions.length === 0) {
          delete message.reaction[fromId];
        } else {
          message.reaction[fromId] = { emoji: reactions, data };
        }
      });
    },
    setLogoutState: (state: WritableDraft<RoomMessagesState>) => {
      state.rooms = {};
      state.activeRoomJID = null;
      state.visibleRoomJID = null;
      state.isLoading = false;
      state.isUnreadSyncing = false;
      state.privateStoreMarkers = {};
      state.readBoundaries = {};
      state.usersSet = {};
      state.jumpWindow = null;
      state.archivedMessage = null;
      state.pendingJump = null;
    },
    setActiveMessage: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ id: string; chatJID: string }>
    ) => {
      const { id, chatJID } = action.payload;
      if (!isSafeKey(chatJID) || !state.rooms[chatJID]) {return;}
      const flag = (message: IMessage) => {
        message.activeMessage = message.id === id;
      };
      state.rooms[chatJID].messages.forEach(flag);
      if (state.jumpWindow?.roomJID === chatJID) {
        state.jumpWindow.messages.forEach(flag);
      }
    },
    setCloseActiveMessage: (
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ chatJID: string }>
    ) => {
      const { chatJID } = action.payload;
      if (!isSafeKey(chatJID) || !state.rooms[chatJID]) {return;}
      state.rooms[chatJID].messages.forEach((message) => {
        message.activeMessage = false;
      });
      if (state.jumpWindow?.roomJID === chatJID) {
        state.jumpWindow.messages.forEach((message) => {
          message.activeMessage = false;
        });
      }
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
        usersCnt: resolveIncomingUsersCnt(room, existing),
        icon: room.icon ?? existing?.icon,
        messages:
          existingMessages.length > 0 ? existingMessages : incomingMessages,
        // A seed for the room-list preview (the API's `lastMessage`): take the
        // freshest value, never let a refresh without one erase it.
        lastMessage: room.lastMessage ?? existing?.lastMessage,
        unreadMessages: existing?.unreadMessages ?? room.unreadMessages ?? 0,
        ...resolveApiUnread(state, room.jid, room, existing),
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
        if (!isSafeKey(patch?.jid)) {continue;}
        const room = state.rooms[patch.jid];
        if (!room || typeof room !== 'object' || Array.isArray(room)) {continue;}
        if (typeof patch.historyPreloadState !== 'undefined') {
          room.historyPreloadState = patch.historyPreloadState;
        }
        if (typeof patch.unreadCapped !== 'undefined') {
          room.unreadCapped = patch.unreadCapped;
        }
        if (typeof patch.historyComplete !== 'undefined') {
          room.historyComplete = patch.historyComplete;
        }
        if (patch.messageStats) {
          room.messageStats = { ...room.messageStats, ...patch.messageStats };
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
    // Merges resolved room members into the identity cache Message.tsx /
    // resolveSenderDisplayName read from. Keyed by BOTH the bare local
    // part and the full jid so either lookup style hits — a message's
    // `user.id` can be either depending on how it was parsed.
    mergeUsersSet(
      state: WritableDraft<RoomMessagesState>,
      action: PayloadAction<{ members: Record<string, any> }>
    ) {
      // A real merge with a cap: fresh entries win (and move to the newest
      // position), entries fetched lazily earlier stay, the oldest-inserted
      // are evicted past USERS_SET_CAP. Unsafe keys are skipped.
      if (!state.usersSet || typeof state.usersSet !== 'object') {
        state.usersSet = {};
      }
      mergeIntoUsersSet(state.usersSet, action.payload?.members || {});
    },
};

export const roomsStore: Slice<RoomMessagesState, typeof reducers, 'roomMessages'> = createSlice({
  name: 'roomMessages',
  initialState,
  reducers,
});

// Re-exported for backward compatibility - every existing call site
// imports `msgSortableMs` from here. The implementation now lives in
// helpers/msgSortableMs.ts (imported above), so insertMessageWithDelimiter.ts
// (which this file itself imports) can use the SAME ordering source
// without a roomStore <-> helpers import cycle. See that file for the
// full rationale (server id vs. client `date`).
export { msgSortableMs };

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

// Bug #38 tolerance: a stored read marker more than this far past the
// newest message a room actually has is not "the user is a little
// ahead" - it's a leftover from a device whose clock was wrong when it
// stamped the marker. Kept in sync with (but duplicated from, to avoid
// a roomStore ↔ helpers import cycle) FUTURE_READ_MARKER_TOLERANCE_MS
// in helpers/getServerReadTimestamp.ts.
const FUTURE_MARKER_TOLERANCE_MS = 5 * 60 * 1000;

// Newest message in `messages` this room actually has proof the server
// accepted - used only to sanity-check an already-stored read marker
// against reality (see applyPrivateStoreMarkers's self-heal). Excludes
// pending/optimistic sends via the `pending` flag alone: unlike
// getServerReadTimestamp, this runs inside a reducer and can't reach
// across to the roomHeapSlice slice, but `pending` already identifies
// every optimistic send that matters for this comparison.
const newestAckedMessageMs = (messages: IMessage[] | undefined): number => {
  let newest = 0;
  for (const m of messages || []) {
    if (!m || m.id === 'delimiter-new' || m.pending) {continue;}
    const ms = msgSortableMs(m);
    if (ms > newest) {newest = ms;}
  }
  return newest;
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
  setUnreadSyncing,
  setLastViewedTimestamp,
  applyPrivateStoreMarkers,
  setReadBoundary,
  clearReadBoundary,
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
  requestJumpToMessage,
  clearPendingJump,
  setJoiningRoom,
  clearJoiningRoom,
  setReactions,
  mergeUsersSet,
  removeRoomMessage,
  addRoomFromApi,
  setMessageTranslation,
  showArchivedMessage,
  clearArchivedMessage,
  setJumpWindow,
  prependJumpWindowMessages,
  appendJumpWindowMessages,
  clearJumpWindow,
} = roomsStore.actions;

export default roomsStore.reducer;
