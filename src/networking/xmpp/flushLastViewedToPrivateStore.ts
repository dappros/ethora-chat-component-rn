import { getChatsPrivateStoreRequest } from './getChatsPrivateStoreRequest.xmpp';
import { setChatsPrivateStoreRequest } from './setChatsPrivateStoreRequest.xmpp';

interface RoomLike {
  jid: string;
  lastViewedTimestamp?: number;
  unreadMessages?: number;
}

interface FlushOpts {
  // When activeRoomJID is set, treat it as "user just viewed everything
  // up to now" and stamp it with Date.now() — even if its in-memory
  // lastViewedTimestamp is 0 (which means "actively viewing" in
  // roomsSlice).
  activeRoomJID?: string | null;
  // If true, only write entries for rooms where unreadMessages === 0
  // (or the active room). Used at logout time: rooms with outstanding
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
  const { activeRoomJID, onlyIfNoUnread } = opts;
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
    const isActive = !!activeRoomJID && room.jid === activeRoomJID;
    const hasUnread = Number(room.unreadMessages || 0) > 0;

    // For the active room, persist "now" — the in-memory value is 0
    // (sentinel for "user is here") and writing 0 would mark all
    // history unread on next login.
    let ts: number | undefined;
    if (isActive) {
      ts = nowMs;
    } else if (room.lastViewedTimestamp) {
      ts = room.lastViewedTimestamp;
    }

    if (!ts) {continue;}
    if (onlyIfNoUnread && hasUnread && !isActive) {continue;}

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
