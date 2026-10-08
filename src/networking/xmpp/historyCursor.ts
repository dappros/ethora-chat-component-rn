import { store } from '../../roomStore';
import { updateRoom } from '../../roomStore/roomsSlice';
import { IRoom } from '../../types/types';

/** Archive ids are microsecond stamps (16 digits today); anything below this is not one. */
const MIN_ARCHIVE_ID = 1e14;

export const isArchiveCursor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > MIN_ARCHIVE_ID;

/** What the room held when a page was requested (a page answers later, and the live handler fills the room meanwhile). */
export interface RoomHistorySnapshot {
  hadMessages: boolean;
  /** Newest archive id among the real cached messages, 0 when none. */
  newestId: number;
}

export const snapshotRoomHistory = (roomJid: string): RoomHistorySnapshot => {
  const messages = store.getState().rooms.rooms?.[roomJid]?.messages || [];
  let newestId = 0;
  let hadMessages = false;
  for (const message of messages) {
    if (!message || message.id === 'delimiter-new' || message.pending) continue;
    // Client-only call-log fallbacks never exist on the server.
    if (String(message.id || '').startsWith('calllog-')) continue;
    hadMessages = true;
    const id = Number(message.id);
    if (isArchiveCursor(id) && id > newestId) newestId = id;
  }
  return { hadMessages, newestId };
};

export interface HistoryPageFin {
  roomJid: string;
  /** The `<fin>` element was present in the answer. */
  finSeen: boolean;
  complete: boolean;
  first: number | null;
  last: number | null;
  /** Result stanzas the page carried (receipts and reactions included). */
  received: number;
}

/**
 * Write the SERVER's paging cursor after a page that feeds the live list:
 * room.messageStats.firstMessageTimestamp is the oldest archive id of the
 * contiguous history (`<fin><set><first>`), room.historyComplete is the fin's
 * `complete` flag. Windowed queries never come here.
 *
 *  - an older page (before set) moves the cursor back, never forward;
 *  - a LATEST page must not raise an older cursor when the room already had
 *    messages (a late answer would send the loader back to a page it holds);
 *  - a full latest page that starts after everything cached leaves a hole, so
 *    the cursor restarts at the page's oldest id and the room is not complete.
 */
export const applyHistoryPageCursor = (
  page: HistoryPageFin,
  request: { before?: number; max: number },
  snapshot: RoomHistorySnapshot
): void => {
  if (!page.finSeen || !page.roomJid) return;
  const room: IRoom | undefined = store.getState().rooms.rooms?.[page.roomJid];
  if (!room) return;

  const isLatest = request.before === undefined;
  const known = room.messageStats;
  const knownCursor = isArchiveCursor(known?.firstMessageTimestamp)
    ? known?.firstMessageTimestamp
    : undefined;

  let cursor: number | undefined;
  let complete: boolean | undefined;

  if (page.first !== null) {
    if (!isLatest) {
      cursor =
        knownCursor !== undefined ? Math.min(knownCursor, page.first) : page.first;
      complete = page.complete;
    } else {
      const gap =
        snapshot.newestId > 0 &&
        page.received >= request.max &&
        page.first > snapshot.newestId;
      if (gap) {
        cursor = page.first;
        complete = false;
      } else {
        const keepOlder =
          snapshot.hadMessages &&
          knownCursor !== undefined &&
          knownCursor < page.first;
        cursor = keepOlder ? knownCursor : page.first;
        // A latest page proves completeness only when the whole archive fit.
        if (page.complete) complete = true;
      }
    }
  } else if (!isLatest) {
    // An older page with nothing in it: the archive has nothing further back.
    complete = page.complete;
  } else if (page.complete) {
    complete = true;
  }

  const updates: Partial<IRoom> = {};
  if (typeof complete === 'boolean' && room.historyComplete !== complete) {
    updates.historyComplete = complete;
  }
  const nextFirst = cursor ?? known?.firstMessageTimestamp;
  const nextLast =
    isLatest && page.last !== null ? page.last : known?.lastMessageTimestamp;
  if (
    (cursor !== undefined && cursor !== known?.firstMessageTimestamp) ||
    nextLast !== known?.lastMessageTimestamp
  ) {
    updates.messageStats = {
      ...(known || {}),
      ...(nextFirst !== undefined ? { firstMessageTimestamp: nextFirst } : {}),
      ...(nextLast !== undefined ? { lastMessageTimestamp: nextLast } : {}),
    };
  }
  if (Object.keys(updates).length) {
    store.dispatch(updateRoom({ jid: page.roomJid, updates }));
  }
};
