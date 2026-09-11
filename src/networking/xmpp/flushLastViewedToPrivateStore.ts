import { getChatsPrivateStoreRequest } from './getChatsPrivateStoreRequest.xmpp';
import { setChatsPrivateStoreRequest } from './setChatsPrivateStoreRequest.xmpp';
import {
  getServerReadTimestamp,
  isCorruptFutureReadMarker,
  type ReadTimestampHeapState,
} from '../../helpers/getServerReadTimestamp';
import type { IMessage } from '../../types/types';

interface RoomLike {
  jid: string;
  lastViewedTimestamp?: number;
  unreadMessages?: number;
  // Needed to resolve a SERVER-timestamp read marker via
  // getServerReadTimestamp instead of the device clock - see bug #38.
  messages?: IMessage[];
}

interface FlushOpts {
  // When visibleRoomJID is set, treat it as "user just viewed everything
  // up to now" and stamp it with the newest server-acknowledged message
  // timestamp for that room - even if its in-memory lastViewedTimestamp
  // has not been updated yet.
  visibleRoomJID?: string | null;
  // Explicit read boundary for the visible room, used INSTEAD of the
  // newest-message fallback. ChatRoom passes the timestamp of the newest
  // message the user actually reached when they leave a room while
  // scrolled up - without it, the default writes "read everything" to
  // the server and the messages they never scrolled down to come back as
  // read on the next login, even though the local count was correct.
  // Customer-reported #33 (server half).
  visibleRoomTs?: number | null;
  // If true, only write entries for rooms where unreadMessages === 0
  // (or the visible room). Used at logout time: rooms with outstanding
  // unread keep their old marker so the next login still surfaces them.
  onlyIfNoUnread?: boolean;
  // Pending/failed-send state (store.getState().roomHeapSlice), combined
  // with each room's `messages` to resolve the newest SERVER-acked
  // message timestamp via getServerReadTimestamp. Passed in rather than
  // read from the store here so this module stays a pure function of its
  // arguments - existing jest coverage builds `rooms` by hand.
  heapState?: ReadTimestampHeapState;
}

/**
 * Merge in-memory lastViewedTimestamp values into the server-side
 * private store. Reads current state, overlays per-room updates, writes
 * back. Single round-trip so concurrent open clients don't trample
 * each other's entries.
 *
 * Called on: tab change away from chat, AppState background/inactive,
 * and (with onlyIfNoUnread=true) logout. ChatRoom's own unmount path also
 * goes through this (via flushLastViewedToPrivateStoreStanza) for the
 * single-room case - actionSetTimestampToPrivateStore is a separate,
 * unconditional low-level write primitive kept for direct/external use
 * and is not part of this merge path.
 */
export async function flushLastViewedToPrivateStore(
  client: any,
  rooms: Record<string, RoomLike> | null | undefined,
  opts: FlushOpts = {}
): Promise<boolean> {
  if (!client?.client) {return false;}
  const { visibleRoomJID, visibleRoomTs, onlyIfNoUnread, heapState } = opts;
  const roomList = Object.values(rooms || {});
  if (roomList.length === 0) {return false;}

  let storeObj: any = null;
  try {
    storeObj = await getChatsPrivateStoreRequest(client.client);
  } catch {
    storeObj = null;
  }
  if (!storeObj || typeof storeObj !== 'object') {storeObj = {};}

  let dirty = false;

  for (const room of roomList) {
    if (!room?.jid) {continue;}
    const isVisible = !!visibleRoomJID && room.jid === visibleRoomJID;
    const hasUnread = Number(room.unreadMessages || 0) > 0;

    // Newest message this room actually has server-side proof of. Used
    // both as the "read up to now" fallback for the visible room and as
    // the yardstick for detecting a corrupt (future) stored marker below
    // - never as a substitute for the device clock (bug #38: a device
    // with a fast clock previously stamped Date.now() here, and once
    // that future value reached the server the forward-only check a few
    // lines down rejected every later correct write, forever).
    const newestAckedMs = getServerReadTimestamp(room as any, heapState);

    // For the visible room, persist "read up to the newest message we
    // know the server has" - read state is driven by room visibility,
    // not by a sentinel timestamp. The exception is an explicit
    // `visibleRoomTs`: the caller knows the user only read up to a
    // certain point (left the room while scrolled up), so stamping
    // "everything" here would mark genuinely-unread messages as read.
    let ts: number | undefined;
    if (isVisible) {
      ts =
        typeof visibleRoomTs === 'number' && visibleRoomTs > 0
          ? visibleRoomTs
          : newestAckedMs || undefined;
    } else if (room.lastViewedTimestamp && room.lastViewedTimestamp > 0) {
      ts = room.lastViewedTimestamp;
    }

    // Nothing to anchor a write to (no boundary, no existing marker, no
    // known messages yet) - skip rather than write a device-clock guess.
    if (!ts) {continue;}
    if (onlyIfNoUnread && hasUnread && !isVisible) {continue;}

    const prev = storeObj[room.jid];
    const prevNum = prev != null ? Number(prev) : 0;
    // A currently-stored value that sits well past the newest message we
    // know this room has is not "fresher" - it's a leftover future
    // marker (bug #38). Forward-only logic normally protects a fresher
    // read from being clobbered by a stale fetch, but applied to a
    // corrupt future value it does the opposite: it permanently blocks
    // the correct (smaller) value from ever landing. Detect that case
    // and waive the forward-only check for it specifically; sane values
    // keep the normal forward-only protection.
    //
    // "Well past the newest message we know about" is deliberately NOT
    // sufficient on its own - see isCorruptFutureReadMarker. THIS device's
    // copy of the room can simply be stale (history not synced yet this
    // session), in which case a legitimate marker written by another
    // device that HAS seen newer messages looks exactly like a corrupt
    // one, and "healing" it here would push the server marker BACKWARDS
    // and resurrect already-read messages on every device.
    const prevLooksCorrupt = isCorruptFutureReadMarker(prevNum, newestAckedMs);
    if (!prevLooksCorrupt && Number.isFinite(prevNum) && prevNum >= ts) {continue;}
    storeObj[room.jid] = String(ts);
    dirty = true;
  }

  if (!dirty) {return false;}

  try {
    await setChatsPrivateStoreRequest(client.client, JSON.stringify(storeObj));
    return true;
  } catch {
    return false;
  }
}
