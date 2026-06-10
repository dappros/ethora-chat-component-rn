/**
 * Outbound-send queue — buffers message stanzas that can't reach the wire
 * because there is no live XMPP stream at send time, and replays them once
 * a stream comes (back) online.
 *
 * Lives at MODULE scope on purpose, NOT on the XmppClient instance: the
 * exact windows we need to cover are the ones where the instance itself is
 * gone or being swapped —
 *   1. start race — a send fires before the provider's bootstrap has run
 *      `setClient(created)`, so `useSendMessage` sees `client === null` and
 *      used to throw "No XMPP client".
 *   2. full-reinit race — after 3 failed reconnects the provider does
 *      `setClient(null)` then re-`initializeClient`s; sends in that gap
 *      also saw `client === null`.
 *   3. reconnect window — the instance survives but its underlying stream
 *      is `connecting`/`offline`; a fire-and-forget stanza is silently lost
 *      and only the 30s watchdog notices.
 *
 * Each queued item carries a `send(client)` closure that captures the
 * original args (text or media), so flush is type-agnostic.
 *
 * TTL is deliberately aligned with the pending-send watchdog in
 * useSendMessage (PENDING_WATCHDOG_MS): a queued item older than that has
 * already been — or is about to be — flipped to "Failed → tap to retry" by
 * the watchdog, so replaying it on a late reconnect would duplicate the
 * bubble. We drop those on flush and let the watchdog own the failure.
 */

export interface OutboundQueueClient {
  sendMessage: (...args: any[]) => any;
  sendMediaMessageStanza: (...args: any[]) => any;
}

export interface QueuedSend {
  /** Optimistic/stanza id — used to dedupe re-enqueues (e.g. media retry). */
  optimisticId: string;
  roomJID: string;
  /** Wall-clock ms when first queued; drives the TTL drop on flush. */
  enqueuedAt: number;
  /**
   * Per-item replay window. Kept in lockstep with the matching send
   * watchdog so a reconnect inside the window replays the buffered send,
   * while a longer drop lets the watchdog own the failure (no duplicate).
   * Text uses 5s, media 30s (large uploads need longer). Falls back to
   * OUTBOUND_QUEUE_TTL_MS when omitted.
   */
  ttlMs?: number;
  /** Replays the original send against a live, online client. */
  send: (client: OutboundQueueClient) => void;
}

// Default replay window (text). Mirrors PENDING_WATCHDOG_MS in useSendMessage.
// Media enqueues a longer per-item ttlMs (see QueuedSend.ttlMs).
export const OUTBOUND_QUEUE_TTL_MS = 30_000;

let queue: QueuedSend[] = [];

/**
 * Append (or, if the id is already queued, replace in place) a pending
 * send. Order is preserved for FIFO flush.
 */
export function enqueueOutboundSend(item: QueuedSend): void {
  const idx = queue.findIndex((q) => q.optimisticId === item.optimisticId);
  if (idx >= 0) {
    // Re-enqueue of the same id (e.g. a media retry): refresh in place so
    // we don't grow a duplicate, and keep its original position.
    queue[idx] = item;
    return;
  }
  queue.push(item);
}

/**
 * Replay every queued send (in order) against a now-online client. Items
 * older than the TTL are dropped — the send watchdog has already failed
 * them, so re-sending would duplicate. The queue is emptied either way.
 */
export function flushOutboundSends(
  client: OutboundQueueClient,
  now: number
): void {
  if (queue.length === 0) {return;}
  const pending = queue;
  queue = [];
  for (const item of pending) {
    if (now - item.enqueuedAt > (item.ttlMs ?? OUTBOUND_QUEUE_TTL_MS)) {
      // Stale — the send watchdog owns the failure; don't duplicate.
      continue;
    }
    try {
      item.send(client);
    } catch (err) {
      // A single bad replay must not strand the rest of the queue.
      console.warn('flushOutboundSends: replay failed', item.optimisticId, err);
    }
  }
}

/**
 * Drop a single buffered send by its optimistic/stanza id. Called when a
 * server-confirmed copy of the message arrives (see newMessageMidlleware):
 * the send went through, so the buffered replay is no longer needed and must
 * not fire on a later reconnect. No-op if the id isn't queued.
 */
export function removeOutboundSend(optimisticId: string): void {
  if (!optimisticId) {return;}
  const idx = queue.findIndex((q) => q.optimisticId === optimisticId);
  if (idx >= 0) {queue.splice(idx, 1);}
}

/** Drop everything — called on permanent teardown (logout / close). */
export function clearOutboundSends(): void {
  queue = [];
}

/** Current depth — for tests and diagnostics. */
export function outboundQueueLength(): number {
  return queue.length;
}
