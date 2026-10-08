import { AppState } from 'react-native';
import XmppClient from '../networking/xmppClient';
import { store } from '../roomStore';
import {
  applyRoomsPreloadBatch,
  setUnreadSyncing,
  RUNTIME_MESSAGE_LIMIT,
} from '../roomStore/roomsSlice';
import { IMessage, IRoom } from '../types/types';
import {
  getMessageTimestamp,
  getRoomLastActivityScore,
} from './roomActivityScore';

interface HistoryPreloadSchedulerOptions {
  client: XmppClient;
  signal?: AbortSignal;
  concurrency?: number;
  pageSize?: number;
  retryLimit?: number;
  roomLimit?: number;
  firstWave?: number;
  selectedRoomJid?: string | null;
  defaultRoomJids?: string[];
  forceReload?: boolean;
  // State stamped on successfully preloaded rooms. The staged flow's first
  // (preview) pass uses 'partial' so the second, bigger-page pass still
  // processes those rooms; only 'done' short-circuits future preloads.
  completionState?: 'done' | 'partial';
  // Preview pass: skip rooms that already have a list preview (loaded
  // messages, or an API `lastMessage` seed from /chats/my). The pass exists
  // only to fill that preview, so for those rooms it would be a wasted MAM
  // query. `roomLimit` then counts the rooms that actually needed one.
  skipApiPreview?: boolean;
}

interface QueueItem {
  jid: string;
  priority: number;
  activityScore: number;
  attempts: number;
  readyAt: number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_RETRY_LIMIT = 2;
const DEFAULT_FIRST_WAVE = 30;
// Past the first wave a worker rests this long between rooms, so a long
// background sweep does not saturate the socket a user is also chatting on.
const BACKGROUND_ROOM_PAUSE_MS = 400;
// When the first page is entirely unread (every fetched message is newer
// than `lastViewedTimestamp`), the true unread count could be far bigger
// than `pageSize` - `useUnread()` only ever sees what's been loaded. Page
// further back, up to this many extra fetches, until we either find the
// boundary or give up (`unreadCapped` then stays true so callers at least
// know the count is a floor, not exact). Customer-reported #34.
const MAX_UNREAD_CATCHUP_PAGES = 8;
// How many older pages one room may pull when its newest page has rows but
// nothing displayable (reactions / receipts only). Bounds the worst case.
const MAX_EMPTY_PAGE_FOLLOWS = 4;
const FOLLOW_PAGE_SIZE = 10;
// A room's first MAM page waits at most this long for its (deduped) join.
const JOIN_BEFORE_FETCH_TIMEOUT_MS = 3000;

// Marker for "MAM returned an empty page for a room the server hasn't
// declared complete" - retried like a failure, but never terminal.
const EMPTY_PAGE_ERROR = 'history_empty_page';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

declare const __DEV__: boolean | undefined;

const messageTimestamp = (m: IMessage): number => getMessageTimestamp(m);

// Store keys that can be a room (`local@domain`); root-slice keys that leak
// into `rooms.rooms` from corrupted persisted state have no `@`.
const isRoomKey = (jid: string): boolean => {
  const at = jid.indexOf('@');
  return at > 0 && at < jid.length - 1;
};

const computeUnreadCapped = (
  room: IRoom,
  messages: IMessage[],
  pageSize: number
): boolean => {
  if (!room) {return false;}
  if (!messages || messages.length < pageSize) {return false;}
  if (room.historyComplete === true) {return false;}

  const countable = messages.filter(
    (msg) => !!msg && msg.id !== 'delimiter-new' && !msg.pending
  );
  if (countable.length < pageSize) {return false;}

  const lastViewed = Number(room.lastViewedTimestamp) || 0;
  // No read marker yet (the private-store markers often land after the
  // first preload page): the count is unknown, not "more than a page".
  // Claiming capped here showed "10+" on rooms with a single unread.
  if (lastViewed <= 0) {return false;}

  const oldestTs = countable.reduce<number>((minTs, m) => {
    const ts = messageTimestamp(m);
    if (!Number.isFinite(ts) || ts <= 0) {return minTs;}
    return Math.min(minTs, ts);
  }, Number.MAX_SAFE_INTEGER);
  if (!Number.isFinite(oldestTs) || oldestTs === Number.MAX_SAFE_INTEGER)
    {return false;}
  return oldestTs > lastViewed;
};

const getRoomPriority = (
  jid: string,
  _room: IRoom,
  selectedRoomJid: string | null,
  defaultRoomJids: Set<string>
): number => {
  if (selectedRoomJid && selectedRoomJid === jid) {return 0;}
  if (defaultRoomJids.has(jid)) {return 1;}
  return 2;
};

const shouldPauseForVisibility = (): boolean => {
  return AppState.currentState !== 'active';
};

// A room list preview that came from /chats/my: a seeded `lastMessage` and no
// loaded messages. Exported for the scheduler's tests.
export const hasApiPreview = (room?: IRoom): boolean =>
  !!room &&
  (room.messages?.length ?? 0) === 0 &&
  !!String(room.lastMessage?.body || '').trim();

// Anything the room list can already render a preview from.
const hasListPreview = (room?: IRoom): boolean =>
  !!room &&
  ((room.messages?.length ?? 0) > 0 ||
    !!String(room.lastMessage?.body || '').trim());

// Sweeps of one client run one after the other (the staged flow's preview
// and full-page passes, a bootstrap racing the chat wrapper's own start).
// CHAINED, not deduped onto one promise: each caller carries its own
// pageSize/completionState, so handing a late caller someone else's promise
// would silently skip its work; the per-room historyPreloadState guard makes
// the follow-up cheap wherever an earlier sweep already did the job.
const preloadChainByClient = new Map<string, Promise<void>>();
// The "unread syncing" flag stays up while ANY sweep runs (a counter, not a
// per-sweep toggle, so chained sweeps do not flicker it off between them).
let activeSweeps = 0;

const getClientKey = (client: XmppClient): string =>
  (client as any)?.client?.jid?.toString?.() ||
  (client as any)?.username ||
  'xmpp-client';

/**
 * Background-loads message history into the redux store. Rooms are picked by
 * selected/default rooms first, then by recent activity; a room the user
 * opens while the sweep runs jumps the queue. Coalesces with the XMPP
 * client's MAM queue (so the active-room scroll fetch wins).
 */
export const runHistoryPreloadScheduler = (
  options: HistoryPreloadSchedulerOptions
): Promise<void> => {
  const clientKey = getClientKey(options.client);
  const previous = preloadChainByClient.get(clientKey) || Promise.resolve();

  const run = previous
    .catch(() => {})
    .then(() => runHistoryPreloadSweep(options));

  const tracked = run
    .catch(() => {})
    .finally(() => {
      if (preloadChainByClient.get(clientKey) === tracked) {
        preloadChainByClient.delete(clientKey);
      }
    });
  preloadChainByClient.set(clientKey, tracked);
  return run;
};

const runHistoryPreloadSweep = async (
  options: HistoryPreloadSchedulerOptions
): Promise<void> => {
  const {
    client,
    signal,
    concurrency = DEFAULT_CONCURRENCY,
    pageSize = DEFAULT_PAGE_SIZE,
    retryLimit = DEFAULT_RETRY_LIMIT,
    roomLimit,
    firstWave = DEFAULT_FIRST_WAVE,
    selectedRoomJid = null,
    defaultRoomJids = [],
    forceReload = false,
    completionState = 'done',
    skipApiPreview = false,
  } = options;

  if (signal?.aborted) {return;}

  const startedAt = Date.now();
  let firstWaveLogged = false;
  let started = 0;
  const devLog = (msg: string) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {console.log(msg);}
  };

  activeSweeps += 1;
  if (activeSweeps === 1) {store.dispatch(setUnreadSyncing(true));}
  try {
    await runSweepBody();
  } finally {
    devLog(`[preload] finished in ${Date.now() - startedAt}ms`);
    activeSweeps -= 1;
    if (activeSweeps === 0) {store.dispatch(setUnreadSyncing(false));}
  }

  async function runSweepBody(): Promise<void> {
    const rooms = (store.getState().rooms.rooms || {}) as Record<string, IRoom>;
    const defaultSet = new Set(defaultRoomJids);

    const sortedQueue: QueueItem[] = Object.entries(rooms)
      .filter(([jid]) => isRoomKey(jid))
      .map(([jid, room]: [string, IRoom]) => ({
        jid,
        priority: getRoomPriority(jid, room, selectedRoomJid, defaultSet),
        activityScore: getRoomLastActivityScore(room),
        attempts: 0,
        readyAt: Date.now(),
      }))
      .sort((a, b) => {
        if (a.priority !== b.priority) {return a.priority - b.priority;}
        if (a.activityScore !== b.activityScore) {
          return b.activityScore - a.activityScore;
        }
        return a.jid.localeCompare(b.jid);
      });
    // Top-N by recent activity FIRST, then drop what needs no work.
    // Filtering 'done' rooms before the cut would let every reconnect slide
    // the window down the list (the 8 done rooms vanish, the next 8 get
    // preloaded), so "top N" would quietly grow into "all" over a few
    // reconnects. The preview pass is the exception: it counts rooms that
    // still LACK a preview, because a room the API gave no `lastMessage`
    // for ranks at the bottom of an activity sort and would otherwise never
    // get one.
    const needsWork = (item: QueueItem): boolean => {
      const room = rooms[item.jid];
      if (!forceReload && room?.historyPreloadState === 'done') {return false;}
      if (skipApiPreview && hasListPreview(room)) {return false;}
      return true;
    };
    const withLimit = (items: QueueItem[]) =>
      roomLimit && roomLimit > 0 ? items.slice(0, roomLimit) : items;
    const queue: QueueItem[] = skipApiPreview
      ? withLimit(sortedQueue.filter(needsWork))
      : withLimit(sortedQueue).filter(needsWork);

    const inFlightByRoom = new Map<string, Promise<void>>();
    let consecutiveErrorCount = 0;
    devLog(
      `[preload] ${queue.length} rooms queued, first wave ${Math.min(firstWave, queue.length)}, page ${pageSize}`
    );

    // Rooms that no longer need this sweep's work: preloaded by another path
    // (the user opened them, a parallel bootstrap, an earlier sweep) or gone.
    // Checked when an item is PICKED, before the 'loading' flag is written:
    // flagging a batch 'loading' first and asking "already done?" after could
    // never be true, so every reconnect refetched done rooms and flickered
    // them through 'loading'.
    const isSatisfied = (jid: string): boolean => {
      const current = store.getState().rooms.rooms[jid];
      if (!current) {return true;}
      if (forceReload) {return false;}
      return current.historyPreloadState === 'done';
    };

    const pickNext = (): QueueItem | null => {
      const now = Date.now();
      const activeJid = store.getState().rooms.activeRoomJID;
      // A room the user opened while the sweep runs jumps the queue.
      let best = -1;
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (item.readyAt > now || inFlightByRoom.has(item.jid)) {continue;}
        if (best === -1) {
          best = index;
          continue;
        }
        if (activeJid && item.jid === activeJid) {
          best = index;
          break;
        }
      }
      if (best === -1) {return null;}
      return queue.splice(best, 1)[0];
    };

    const processItem = async (item: QueueItem): Promise<void> => {
      if (isSatisfied(item.jid)) {
        // Nothing to fetch. Leave the state alone: stamping 'done' on a room
        // that is merely missing would resurrect it as a ghost entry.
        return;
      }

      store.dispatch(
        applyRoomsPreloadBatch({
          rooms: [{ jid: item.jid, historyPreloadState: 'loading' }],
        })
      );

      try {
        // MAM does not need the room joined, but a room that is not joined
        // yet gets its (deduped) join first, best effort: the join sweep may
        // not have reached it, and a members-only archive wants it.
        try {
          await (client as any).ensureRoomPresence?.(item.jid, {
            timeoutMs: JOIN_BEFORE_FETCH_TIMEOUT_MS,
            source: 'background',
            // The sweep merges pages itself (one batch per room, with gap and
            // unread detection): the MAM router must not apply them as well.
            selfApplied: true,
          });
        } catch {}
        if (signal?.aborted) {return;}

        const fetchPage = (max: number, before?: number) =>
          client.getHistoryStanza(item.jid, max, before, undefined, {
            coalesceRoom: true,
            skipIfPreloaded: !forceReload,
            source: 'background',
          });

        let fetchedMessages = await fetchPage(pageSize);
        if (signal?.aborted) {return;}
        if (typeof fetchedMessages === 'undefined') {
          throw new Error('history_timeout');
        }

        // A page can hold rows and still yield nothing displayable: a room
        // whose newest archive rows are reactions or receipts parses to an
        // empty list. That page is inconclusive, not a failure. Follow the
        // server's RSM cursor (stored as messageStats.firstMessageTimestamp)
        // to older pages until something displayable turns up, the archive
        // is exhausted or the budget is spent.
        let pagesFetched = 1;
        let followedCursor = false;
        let lastCursor: number | undefined;
        while (
          fetchedMessages.length === 0 &&
          pagesFetched < MAX_EMPTY_PAGE_FOLLOWS + 1
        ) {
          const roomNow = store.getState().rooms.rooms[item.jid];
          if (roomNow?.historyComplete === true) {break;}
          const cursor = roomNow?.messageStats?.firstMessageTimestamp;
          // No cursor means the server returned no rows at all (not joined /
          // archive not ready): nothing to follow, the retry path handles it.
          if (!cursor || !Number.isFinite(cursor) || cursor === lastCursor) {
            break;
          }
          lastCursor = cursor;
          followedCursor = true;
          const older = await fetchPage(
            Math.max(pageSize, FOLLOW_PAGE_SIZE),
            cursor
          );
          if (signal?.aborted) {return;}
          if (typeof older === 'undefined') {throw new Error('history_timeout');}
          pagesFetched += 1;
          fetchedMessages = older;
        }

        const nextRoom = store.getState().rooms.rooms[item.jid];

        // An empty page for a room the server hasn't declared complete is
        // almost always "not joined / archive not ready yet", not "this room
        // has no messages". Marking it 'done' froze the room with an empty
        // transcript forever. When the cursor was followed and the budget
        // ran out the archive does have rows (just none displayable yet),
        // so that settles as 'partial' straight away; without a cursor the
        // sweep retries.
        const isInconclusiveEmptyPage =
          fetchedMessages.length === 0 && nextRoom?.historyComplete !== true;
        if (isInconclusiveEmptyPage) {
          if (followedCursor) {
            store.dispatch(
              applyRoomsPreloadBatch({
                rooms: [{ jid: item.jid, historyPreloadState: 'partial' }],
              })
            );
            consecutiveErrorCount = 0;
            return;
          }
          throw new Error(EMPTY_PAGE_ERROR);
        }

        let combined: IMessage[] = fetchedMessages;
        const lastViewed = Number(nextRoom?.lastViewedTimestamp) || 0;

        // The first page was entirely unread: keep paging older until a
        // message at/before `lastViewedTimestamp` (the true boundary) is
        // found or the catch-up budget runs out, so the count isn't silently
        // truncated at `pageSize`.
        if (
          lastViewed > 0 &&
          computeUnreadCapped(nextRoom, combined, pageSize)
        ) {
          let lastPageLen = combined.length;
          let extraPages = 0;
          while (
            extraPages < MAX_UNREAD_CATCHUP_PAGES &&
            lastPageLen >= pageSize &&
            !signal?.aborted
          ) {
            const oldestId = combined.reduce<number | null>((min, m) => {
              const idNum = Number((m as any)?.id);
              if (!Number.isFinite(idNum)) {return min;}
              return min === null || idNum < min ? idNum : min;
            }, null);
            if (oldestId === null) {break;}

            let older: IMessage[] | undefined;
            try {
              older = await fetchPage(pageSize, oldestId);
            } catch {
              break;
            }
            if (!older || !older.length) {break;}

            combined = [...older, ...combined];
            lastPageLen = older.length;
            extraPages++;

            const oldestTs = combined.reduce<number>((minTs, m) => {
              const ts = messageTimestamp(m);
              return ts > 0 ? Math.min(minTs, ts) : minTs;
            }, Number.MAX_SAFE_INTEGER);
            if (oldestTs !== Number.MAX_SAFE_INTEGER && oldestTs <= lastViewed) {
              break;
            }
          }
        }

        // `mergeHistoryIntoCache` (roomsSlice) caps whatever we dispatch to
        // the newest RUNTIME_MESSAGE_LIMIT messages before it reaches
        // `unreadMiddleware`, so a catch-up that pulled the true boundary can
        // still have it dropped by that cap (bug #34's failure mode one layer
        // downstream). Simulate the cap so the flag reflects what survives.
        const simulatedStored =
          combined.length > RUNTIME_MESSAGE_LIMIT
            ? combined.slice(-RUNTIME_MESSAGE_LIMIT)
            : combined;
        const unreadCapped = computeUnreadCapped(
          nextRoom,
          simulatedStored,
          pageSize
        );

        store.dispatch(
          applyRoomsPreloadBatch({
            rooms: [
              {
                jid: item.jid,
                messages: combined,
                unreadCapped,
                historyPreloadState: completionState,
              },
            ],
          })
        );
        consecutiveErrorCount = 0;
      } catch (error) {
        const isEmptyPage = (error as Error)?.message === EMPTY_PAGE_ERROR;
        const retries = item.attempts + 1;
        const canRetry = retries <= retryLimit;

        if (canRetry) {
          const jitter = Math.floor(Math.random() * 120);
          const backoff = Math.min(1600, 240 * 2 ** item.attempts) + jitter;
          queue.push({
            ...item,
            attempts: retries,
            readyAt: Date.now() + backoff,
          });
        } else {
          store.dispatch(
            applyRoomsPreloadBatch({
              rooms: [
                {
                  jid: item.jid,
                  // An empty page is inconclusive, not a failure: keep it
                  // retryable so a later pass (or opening the room) can
                  // still fill it in. Real failures end 'error' (retryable
                  // by the next sweep too).
                  historyPreloadState: isEmptyPage ? 'partial' : 'error',
                },
              ],
            })
          );
        }

        // An empty page says nothing about connection health: only real
        // failures trip the circuit breaker below.
        if (isEmptyPage) {return;}
        consecutiveErrorCount += 1;
        if (consecutiveErrorCount >= 3) {
          await sleep(300);
          consecutiveErrorCount = 0;
        }
      }
    };

    // A worker pool, not batches: one slow room (a 10 s MAM timeout) must not
    // idle the other slots. Each worker pulls the next room the moment it is
    // free.
    let activeWorkers = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (signal?.aborted) {return;}
        if (queue.length === 0 && activeWorkers === 0) {return;}

        if (!client.isActiveRoomGateOpen()) {
          await sleep(80);
          continue;
        }
        if (shouldPauseForVisibility()) {
          await sleep(250);
          continue;
        }

        const item = pickNext();
        if (!item) {
          // Queue is empty (another worker may still push a retry) or every
          // remaining item is backing off / in flight.
          if (queue.length === 0 && activeWorkers === 0) {return;}
          await sleep(60);
          continue;
        }

        activeWorkers += 1;
        started += 1;
        const task = processItem(item);
        inFlightByRoom.set(item.jid, task);
        try {
          await task;
        } finally {
          inFlightByRoom.delete(item.jid);
          activeWorkers -= 1;
        }

        // Yield to the JS event loop (no requestIdleCallback in RN); past the
        // first wave, rest a little between rooms.
        const inBackgroundWave = started >= firstWave;
        if (inBackgroundWave && !firstWaveLogged) {
          firstWaveLogged = true;
          devLog(`[preload] first wave done in ${Date.now() - startedAt}ms`);
        }
        await sleep(inBackgroundWave ? BACKGROUND_ROOM_PAUSE_MS : 0);
      }
    };

    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, () => worker())
    );
  }
};

export default runHistoryPreloadScheduler;
