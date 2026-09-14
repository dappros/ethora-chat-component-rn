import type { IMessage, IRoom } from '../types/types';
import { msgSortableMs } from './msgSortableMs';

// A stored/stamped read marker more than this far past the newest
// message we actually know about for a room is not "the user is a
// little ahead" - it's a leftover from a device whose clock was wrong
// when it stamped the marker (bug #38). Generous on purpose: this value
// only controls when we're willing to treat an existing marker as
// corrupt and self-heal it, never how far off a legitimate new write can
// be, so a false positive here just means a bad value survives one extra
// cycle, not that a good value gets rejected.
export const FUTURE_READ_MARKER_TOLERANCE_MS = 5 * 60 * 1000;

export interface ReadTimestampHeapState {
  messageHeap?: IMessage[] | null;
  failedMessages?: Record<string, unknown> | null;
}

type RoomForReadTimestamp = Pick<IRoom, 'jid' | 'messages' | 'lastViewedTimestamp'>;

/**
 * Resolve the "read up to here" marker for `room` using SERVER time,
 * never the device clock.
 *
 * Bug #38: if the device clock is ahead when the user leaves a room, a
 * `Date.now()` read marker lands in the future. The private-store merge
 * (flushLastViewedToPrivateStore.ts) is forward-only ("if (prevNum >=
 * ts) continue"), so once a future marker is written, no later
 * *correct* write can ever replace it - the room's unread count is
 * stuck wrong forever, on every device, from that point on. Anchoring
 * to the newest SERVER-acknowledged message's own timestamp instead
 * means the marker we write can never be ahead of what the server
 * itself has recorded for the room.
 *
 * "Server-acknowledged" excludes:
 *  - a message still marked `pending` (the optimistic bubble shown
 *    while a send is in flight - it carries the DEVICE send time via
 *    `date`, not a server timestamp, until the server echoes it back
 *    and insertMessageWithDelimiter flips `pending` off);
 *  - a message id present in `heapState.messageHeap` (queued retry -
 *    used for offline media sends, see roomHeapSlice.ts) or
 *    `heapState.failedMessages` (a send that never reached the server
 *    at all).
 *
 * `msgSortableMs` (helpers/msgSortableMs.ts) reads the server-assigned microsecond
 * timestamp encoded in the first 13 digits of the message id - the same
 * source already used for message ordering and unread counting - so
 * this stays consistent with the rest of the read/unread pipeline.
 *
 * Falls back to the room's existing `lastViewedTimestamp` (so leaving
 * an empty or never-scrolled room doesn't regress the marker), then to
 * `0` when there's truly nothing to anchor to yet (a brand new room
 * with no history and no prior marker). Callers should treat `0` as
 * "skip the write" rather than substituting a device-clock guess.
 */
export function getServerReadTimestamp(
  room: RoomForReadTimestamp | null | undefined,
  heapState?: ReadTimestampHeapState | null
): number {
  if (!room) {return 0;}

  const heapIds = new Set(
    (heapState?.messageHeap || [])
      .filter((m) => m && m.id != null)
      .map((m) => String(m.id))
  );
  const failedIds = new Set(Object.keys(heapState?.failedMessages || {}));

  let newest = 0;
  const messages = room.messages || [];
  for (const m of messages) {
    if (!m || !m.id) {continue;}
    const id = String(m.id);
    if (id === 'delimiter-new' || id === 'delimiter-new-local') {continue;}
    if ((m as any).pending) {continue;}
    if (heapIds.has(id) || failedIds.has(id)) {continue;}

    const ts = msgSortableMs(m);
    if (ts > newest) {newest = ts;}
  }

  if (newest > 0) {return newest;}
  if (room.lastViewedTimestamp && room.lastViewedTimestamp > 0) {
    return room.lastViewedTimestamp;
  }
  return 0;
}

/**
 * Is `marker` a leftover from a device whose clock was wrong when it
 * stamped a read marker (bug #38)?
 *
 * TWO independent signals must agree before we're willing to throw a
 * stored marker away, because "waive the forward-only guard" is a
 * destructive operation:
 *
 *  1. it sits well past the newest message we know the room has, AND
 *  2. it sits well past real time.
 *
 * Signal 1 alone is NOT enough, and that is the whole point of this
 * function: a device whose local cache for a room is simply stale (very
 * common - any room whose history hasn't been synced yet this session)
 * sees a perfectly legitimate marker written by another device that HAS
 * seen newer messages, and would happily "heal" it backwards, resurrecting
 * already-read messages as unread on every device. A real timestamp can
 * never be ahead of real time, so requiring signal 2 as well means a
 * stale cache on its own can no longer trigger the self-heal.
 *
 * Signal 2 alone is not used either: it would let a device whose own
 * clock is running SLOW mistake every correct marker for a corrupt one.
 */
export function isCorruptFutureReadMarker(
  marker: number,
  newestAckedMs: number
): boolean {
  if (!Number.isFinite(marker) || marker <= 0) {return false;}
  if (!(newestAckedMs > 0)) {return false;}
  if (marker <= newestAckedMs + FUTURE_READ_MARKER_TOLERANCE_MS) {return false;}
  return marker > Date.now() + FUTURE_READ_MARKER_TOLERANCE_MS;
}

/**
 * Resolve the marker to STAMP (locally and to the server) for `room`,
 * honouring an explicit read boundary when one is set.
 *
 * Bug #42 (a regression of #33, reintroduced by #38): #38 made every
 * caller stamp the newest server-acknowledged message unconditionally.
 * That is correct for a user who is at the bottom of the room, but wrong
 * for a user who scrolled up, received messages, and left without
 * scrolling back down - stamping "newest" there silently marks
 * messages they never saw as read, both locally and (because the
 * private-store merge is forward-only) permanently on the server.
 *
 * `boundaryTs` is the msgSortableMs of the newest message the user
 * actually reached (see `readBoundaries` on `RoomMessagesState`,
 * populated by MessageList's `onReadBoundaryChange`). When it's set and
 * positive, it wins - but is still clamped to never exceed the newest
 * server-acknowledged message, so a stale/corrupt boundary can't stamp a
 * marker further ahead than the room's own history supports. When no
 * boundary is set (the common case - the user is at the bottom), this is
 * exactly `getServerReadTimestamp`.
 *
 * Never returns `Date.now()`, directly or indirectly - same rule as
 * `getServerReadTimestamp` (bug #38).
 */
export function getReadMarkerTimestamp(
  room: RoomForReadTimestamp | null | undefined,
  heapState?: ReadTimestampHeapState | null,
  boundaryTs?: number | null
): number {
  const newestAcked = getServerReadTimestamp(room, heapState);
  if (
    typeof boundaryTs === 'number' &&
    Number.isFinite(boundaryTs) &&
    boundaryTs > 0
  ) {
    // `newestAcked === 0` means this room has NOTHING server-acked and no
    // prior marker, so there is nothing to clamp the boundary against -
    // and MessageList derives the boundary from the rendered list, which
    // at that point can only contain pending/failed sends carrying the
    // DEVICE clock via `date`. Returning it here would smuggle a
    // device-clock marker back in through the boundary (bug #38). Return
    // 0 = "nothing to anchor to, skip the write", same contract as
    // getServerReadTimestamp.
    return newestAcked > 0 ? Math.min(boundaryTs, newestAcked) : 0;
  }
  return newestAcked;
}

/**
 * The value to hand `flushLastViewedToPrivateStore` as `visibleRoomTs`
 * for a room being left, or `undefined` when no boundary applies (the
 * flush then uses its own newest-acked default).
 *
 * Exists so the SERVER write goes through the SAME clamp as the local
 * stamp. Passing the raw redux boundary straight through would bypass
 * `getReadMarkerTimestamp`'s clamp on exactly the path where a bad value
 * is permanent: the private-store merge is forward-only, so a boundary
 * that (through a pending own message's device `date`, or a stale
 * readBoundaries entry) sat ahead of the room's real history would be
 * written verbatim and could never be corrected again (bug #38).
 */
export function getFlushBoundaryTs(
  room: RoomForReadTimestamp | null | undefined,
  heapState?: ReadTimestampHeapState | null,
  boundaryTs?: number | null
): number | undefined {
  if (
    typeof boundaryTs !== 'number' ||
    !Number.isFinite(boundaryTs) ||
    boundaryTs <= 0
  ) {
    return undefined;
  }
  const clamped = getReadMarkerTimestamp(room, heapState, boundaryTs);
  return clamped > 0 ? clamped : undefined;
}
