import { getChatsPrivateStoreRequest } from './getChatsPrivateStoreRequest.xmpp';
import { setChatsPrivateStoreRequest } from './setChatsPrivateStoreRequest.xmpp';

interface RoomLike {
  jid: string;
  lastViewedTimestamp?: number;
  unreadMessages?: number;
}

interface FlushOpts {
  // When visibleRoomJID is set, treat it as "user just viewed everything
  // up to now" and stamp it with Date.now() — even if its in-memory
  // lastViewedTimestamp has not been updated yet.
  visibleRoomJID?: string | null;
  // Explicit read boundary for the visible room, used INSTEAD of
  // Date.now(). ChatRoom passes the timestamp of the newest message the
  // user actually reached when they leave a room while scrolled up —
  // without it, the Date.now() default writes "read everything" to the
  // server and the messages they never scrolled down to come back as
  // read on the next login, even though the local count was correct.
  // Customer-reported #33 (server half).
  visibleRoomTs?: number | null;
  // If true, only write entries for rooms where unreadMessages === 0
  // (or the visible room). Used at logout time: rooms with outstanding
  // unread keep their old marker so the next login still surfaces them.
  onlyIfNoUnread?: boolean;
}

/**
 * Merge in-memory lastViewedTimestamp values into the server-side
 * private store. Reads current state, overlays per-room updates, writes
 * back. Single round-trip so concurrent open clients don't trample
 * each other's entries.
 *
 * Called on: tab change away from chat, AppState background/inactive,
 * and (with onlyIfNoUnread=true) logout. ChatRoom's own unmount path
 * still uses actionSetTimestampToPrivateStore for the single-room case.
 */
export async function flushLastViewedToPrivateStore(
  client: any,
  rooms: Record<string, RoomLike> | null | undefined,
  opts: FlushOpts = {}
): Promise<boolean> {
  if (!client?.client) {return false;}
  const { visibleRoomJID, visibleRoomTs, onlyIfNoUnread } = opts;
  const roomList = Object.values(rooms || {});
  if (roomList.length === 0) {return false;}

  let storeObj: any = null;
  try {
    storeObj = await getChatsPrivateStoreRequest(client.client);
  } catch {
    storeObj = null;
  }
  if (!storeObj || typeof storeObj !== 'object') {storeObj = {};}

  const nowMs = Date.now();
  let dirty = false;

  for (const room of roomList) {
    if (!room?.jid) {continue;}
    const isVisible = !!visibleRoomJID && room.jid === visibleRoomJID;
    const hasUnread = Number(room.unreadMessages || 0) > 0;

    // For the visible room, persist "now" — read state is driven by
    // room visibility, not by a sentinel timestamp. The exception is an
    // explicit `visibleRoomTs`: the caller knows the user only read up
    // to a certain point (left the room while scrolled up), so stamping
    // "now" here would mark genuinely-unread messages as read.
    let ts: number | undefined;
    if (isVisible) {
      ts =
        typeof visibleRoomTs === 'number' && visibleRoomTs > 0
          ? visibleRoomTs
          : nowMs;
    } else if (room.lastViewedTimestamp && room.lastViewedTimestamp > 0) {
      ts = room.lastViewedTimestamp;
    }

    if (!ts) {continue;}
    if (onlyIfNoUnread && hasUnread && !isVisible) {continue;}

    const prev = storeObj[room.jid];
    const prevNum = prev != null ? Number(prev) : 0;
    if (Number.isFinite(prevNum) && prevNum >= ts) {continue;}
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
