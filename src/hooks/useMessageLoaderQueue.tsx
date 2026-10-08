import { useCallback, useEffect, useRef } from 'react';
import { IRoom } from '../types/types';

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_POLL_INTERVAL = 1_000;

// A load that never answers must not hold the sweep (and so every later
// tick) forever: past this the room is given up for this round.
const LOAD_DEADLINE_MS = 20_000;

const withDeadline = <T,>(work: Promise<T>, ms: number): Promise<T | void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) {clearTimeout(timer);}
  });
};

const roomHasMoreMessages = (room: IRoom, max: number = 20) =>
  (room.messages?.length ?? 0) < max;

const useMessageLoaderQueue = (
  roomsList: string[],
  rooms: Record<string, IRoom>,
  globalLoading: boolean,
  loading: boolean,
  loadMoreMessages: (roomJid: string, max: number) => Promise<unknown>,
  batchSize: number = DEFAULT_BATCH_SIZE,
  pageSize: number = DEFAULT_PAGE_SIZE,
  pollInterval: number = DEFAULT_POLL_INTERVAL
) => {
  const processedChats = useRef<Set<string>>(new Set());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // One sweep at a time: a sweep can outlast the poll interval (a slow
  // archive answers in seconds), and an overlapping tick would ask for the
  // very rooms the running one is still waiting on.
  const sweepingRef = useRef(false);

  const sweep = useCallback(async () => {
    const unprocessed = roomsList.filter(
      (jid) => !processedChats.current.has(jid)
    );

    if (!unprocessed.length) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    for (let i = 0; i < unprocessed.length; i += batchSize) {
      const batch = unprocessed.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (jid) => {
          const room = rooms[jid];
          if (
            !!room &&
            roomHasMoreMessages(room) &&
            !room.noMessages &&
            !room.historyComplete
          ) {
            try {
              await withDeadline(
                loadMoreMessages(jid, pageSize),
                LOAD_DEADLINE_MS
              );
            } catch (err) {
              console.error(`Error loading messages for ${jid}`, err);
            }

            await new Promise((res) => setTimeout(res, 200));
          }
          processedChats.current.add(jid);
        })
      );
    }
  }, [
    roomsList?.length,
    globalLoading,
    loading,
    loadMoreMessages,
    batchSize,
    pageSize,
  ]);

  const processQueue = useCallback(async () => {
    if (globalLoading || loading || sweepingRef.current) {return;}
    sweepingRef.current = true;
    try {
      await sweep();
    } finally {
      sweepingRef.current = false;
    }
  }, [
    roomsList?.length,
    globalLoading,
    loading,
    loadMoreMessages,
    batchSize,
    pageSize,
  ]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    processedChats.current = new Set();

    if (!globalLoading && !loading && !!roomsList.length) {
      intervalRef.current = setInterval(processQueue, pollInterval);
    }

    return () => {
      if (intervalRef.current) {clearInterval(intervalRef.current);}
    };
  }, [roomsList?.length, globalLoading, loading]);
};

export default useMessageLoaderQueue;
