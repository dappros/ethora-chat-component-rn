import { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useMessageHeapState } from './useMessageHeapState';
import { removeMessageFromHeapById } from '../roomStore/roomHeapSlice';
import XmppClient from '../networking/xmppClient';

// "Joining works" is enough to drain the heap: the first wave of the join
// sweep (open room + one pool width). Waiting for the WHOLE sweep would hold
// queued messages behind joins of rooms nobody is writing to. Clients that
// do not expose the priority flag fall back to the full-sweep flag.
const isJoinReady = (client: XmppClient | null): boolean => {
  if (!client) {return false;}
  const priority = (client as any).priorityPresencesReady;
  return typeof priority === 'boolean' ? priority : !!client.presencesReady;
};

// The flags are plain fields on the client (no re-render when they flip), so
// a drain that finds the gate closed, or a room it could not join, tries
// again on its own.
const RETRY_MS = 1000;

export const useHeapSender = (client: XmppClient | null) => {
  const dispatch = useDispatch();
  const { queue } = useMessageHeapState();
  const sendingRef = useRef(false);
  const inFlightRef = useRef<Map<string, number>>(new Map());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef<() => Promise<void>>(async () => {});

  const scheduleRetry = () => {
    if (retryTimerRef.current) {return;}
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      sendRef.current().catch(() => undefined);
    }, RETRY_MS);
  };

  const sendHeapMessages = useCallback(async () => {
    if (!client || queue.length === 0) {return;}
    if (!isJoinReady(client)) {
      console.warn('Presences not ready, delaying heap send');
      scheduleRetry();
      return;
    }
    if (sendingRef.current) {return;}
    sendingRef.current = true;
    try {
      for (const msg of queue) {
        const lastAttempt = inFlightRef.current.get(msg.id);
        if (lastAttempt && Date.now() - lastAttempt < 15000) {
          continue;
        }
        // Join the message's own room first (deduped, a no-op for a room the
        // sweep already joined). A room that cannot be joined keeps the
        // message queued; it is retried on the next pass.
        let joined: boolean | undefined = true;
        try {
          joined = await client.presenceInRoomStanza?.(msg.roomJid);
        } catch {
          joined = false;
        }
        if (joined === false) {
          scheduleRetry();
          continue;
        }
        inFlightRef.current.set(msg.id, Date.now());
        try {
          if (msg.langSource) {
            await client.sendTextMessageWithTranslateTagStanza(
              msg.roomJid,
              msg.user.firstName || msg.user.name?.split(' ')[0] || '',
              msg.user.lastName || msg.user.name?.split(' ')[1] || '',
              '',
              msg.user.walletAddress || '',
              msg.body,
              '',
              !!msg.isReply,
              msg.showInChannel === 'true',
              msg.mainMessage || '',
              msg.langSource,
              msg.id
            );
          } else {
            await client.sendMessage(
              msg.roomJid,
              msg.user.firstName || msg.user.name?.split(' ')[0] || '',
              msg.user.lastName || msg.user.name?.split(' ')[1] || '',
              '',
              msg.user.walletAddress || '',
              msg.body,
              '',
              !!msg.isReply,
              !!msg.showInChannel,
              msg.mainMessage,
              msg.id
            );
          }
        } catch (err) {
          console.warn('Failed to send heap message', msg, err);
          inFlightRef.current.delete(msg.id);
        }
      }
    } finally {
      sendingRef.current = false;
    }
  }, [client, queue, dispatch]);

  sendRef.current = sendHeapMessages;
  useEffect(
    () => () => {
      if (retryTimerRef.current) {clearTimeout(retryTimerRef.current);}
      retryTimerRef.current = null;
    },
    []
  );

  const prevReadyRef = useRef<boolean>(false);
  useEffect(() => {
    const nowReady = isJoinReady(client);
    const wasReady = prevReadyRef.current;
    prevReadyRef.current = nowReady;
    if (!wasReady && nowReady && queue.length > 0) {
      sendHeapMessages();
    } else if (!nowReady && queue.length > 0) {
      // The ready flag flips on the client without a re-render: poll.
      scheduleRetry();
    }
  }, [client?.presencesReady, client?.priorityPresencesReady, queue.length, sendHeapMessages]);

  useEffect(() => {
    const currentIds = new Set(queue.map((m) => m.id));
    for (const id of Array.from(inFlightRef.current.keys())) {
      if (!currentIds.has(id)) {
        inFlightRef.current.delete(id);
      }
    }
  }, [queue]);

  return { sendHeapMessages };
};
