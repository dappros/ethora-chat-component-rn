import { AppState } from 'react-native';
import XmppClient from '../networking/xmppClient';
import { store } from '../roomStore';
import {
  applyRoomsPreloadBatch,
  setUnreadSyncing,
  RUNTIME_MESSAGE_LIMIT,
} from '../roomStore/roomsSlice';
import { IMessage, IRoom } from '../types/types';

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
const BACKGROUND_BATCH_PAUSE_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

declare const __DEV__: boolean | undefined;

const messageTimestamp = (m: IMessage): number => {
  if (!m) {return 0;}
  const t = (m as any).timestamp;
  if (Number.isFinite(t) && t > 0) {return Number(t);}
  const id = Number(m.id);
  if (Number.isFinite(id) && id > 0) {return id;}
  return 0;
};

const getRoomLastActivityScore = (room: IRoom): number => {
  const fromMessages = room?.messages?.length
    ? room.messages.reduce((max, m) => Math.max(max, messageTimestamp(m)), 0)
    : 0;
  const fromStamp = Number(room?.lastMessageTimestamp) || 0;
  const fromSeed = Number(room?.lastMessage?.id) || 0;
  return Math.max(fromMessages, fromStamp, fromSeed);
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

/**
 * Background-loads message history for every room into the redux store,
 * prioritized by selected/default rooms then by last activity. Coalesces
 * with the XMPP client's MAM queue (so the active-room scroll fetch wins).
 * Mirrors the web `runHistoryPreloadScheduler`.
 */
export const runHistoryPreloadScheduler = async (
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
  } = options;

  if (signal?.aborted) {return;}

  const startedAt = Date.now();
  let firstWaveLogged = false;
  const devLog = (msg: string) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {console.log(msg);}
  };

  store.dispatch(setUnreadSyncing(true));
  try {

  const state = store.getState();
  const rooms = (state.rooms.rooms || {}) as Record<string, IRoom>;
  const defaultSet = new Set(defaultRoomJids);

  const sortedQueue: QueueItem[] = Object.entries(rooms)
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

  const queue: QueueItem[] =
    roomLimit && roomLimit > 0
      ? sortedQueue.slice(0, roomLimit)
      : sortedQueue;

  const inFlightByRoom = new Map<string, Promise<void>>();
  let consecutiveErrorCount = 0;
  let started = 0;
  devLog(
    `[preload] ${queue.length} rooms queued, first wave ${Math.min(firstWave, queue.length)}, page ${pageSize}`
  );

  while (queue.length > 0) {
    if (signal?.aborted) {return;}

    if (!client.isActiveRoomGateOpen()) {
      await sleep(80);
      continue;
    }
    if (shouldPauseForVisibility()) {
      await sleep(250);
      continue;
    }

    const now = Date.now();
    const readyItems = queue.filter(
      (item) => item.readyAt <= now && !inFlightByRoom.has(item.jid)
    );
    if (readyItems.length === 0) {
      await sleep(60);
      continue;
    }

    const batch = readyItems.slice(0, Math.max(1, concurrency));
    const inBackgroundWave = started >= firstWave;
    if (inBackgroundWave && !firstWaveLogged) {
      firstWaveLogged = true;
      devLog(`[preload] first wave done in ${Date.now() - startedAt}ms`);
    }
    started += batch.length;

    // Snapshot each room's historyPreloadState BEFORE marking the
    // batch as 'loading'. Without this snapshot the per-task
    // `currentRoom.historyPreloadState === 'done'` skip check below
    // is dead — the dispatch immediately overwrites 'done' with
    // 'loading', so the task never sees the original value and
    // always re-fetches.
    const preBatchPreloadStateByJid = new Map<string, string | undefined>(
      batch.map((item) => [
        item.jid,
        store.getState().rooms.rooms[item.jid]?.historyPreloadState,
      ])
    );

    store.dispatch(
      applyRoomsPreloadBatch({
        rooms: batch.map((item) => ({
          jid: item.jid,
          historyPreloadState: 'loading',
        })),
      })
    );

    await Promise.all(
      batch.map(async (item) => {
        const queueIndex = queue.findIndex((queued) => queued.jid === item.jid);
        if (queueIndex !== -1) {queue.splice(queueIndex, 1);}

        const task = (async () => {
          const currentRoom = store.getState().rooms.rooms[item.jid];
          const preState = preBatchPreloadStateByJid.get(item.jid);
          if (
            !currentRoom ||
            (!forceReload && preState === 'done')
          ) {
            store.dispatch(
              applyRoomsPreloadBatch({
                rooms: [{ jid: item.jid, historyPreloadState: 'done' }],
              })
            );
            return;
          }

          try {
            const fetchedMessages = await client.getHistoryStanza(
              item.jid,
              pageSize,
              undefined,
              undefined,
              {
                coalesceRoom: true,
                skipIfPreloaded: !forceReload,
                source: 'background',
                selfApplied: true,
              }
            );
            if (signal?.aborted) {return;}
            if (typeof fetchedMessages === 'undefined') {
              throw new Error('history_timeout');
            }

            const nextRoom = store.getState().rooms.rooms[item.jid];
            const combined: IMessage[] = fetchedMessages || [];

            // `mergeHistoryIntoCache` (roomsSlice) caps whatever we dispatch
            // here to the newest RUNTIME_MESSAGE_LIMIT messages before it
            // ever reaches `unreadMiddleware` — so a catch-up fetch that
            // pulled the true boundary can still have it silently dropped
            // by that cap, leaving a falsely-confident `unreadCapped:false`
            // (bug #34's failure mode again, just one layer downstream).
            // Simulate that cap here so the flag reflects what will
            // actually survive, not just what this fetch retrieved.
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
                    historyPreloadState: 'done',
                  },
                ],
              })
            );
            consecutiveErrorCount = 0;
          } catch {
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
                  rooms: [{ jid: item.jid, historyPreloadState: 'error' }],
                })
              );
            }
            consecutiveErrorCount += 1;
            if (consecutiveErrorCount >= 3) {
              await sleep(300);
              consecutiveErrorCount = 0;
            }
          }
        })();

        inFlightByRoom.set(item.jid, task);
        await task.finally(() => inFlightByRoom.delete(item.jid));
      })
    );

    await sleep(inBackgroundWave ? BACKGROUND_BATCH_PAUSE_MS : 0);
  }
  } finally {
    devLog(`[preload] finished in ${Date.now() - startedAt}ms`);
    store.dispatch(setUnreadSyncing(false));
  }
};

export default runHistoryPreloadScheduler;
