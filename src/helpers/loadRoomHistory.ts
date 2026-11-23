import type { IMessage, IRoom } from '../types/types';
import type { HistoryPage } from '../networking/xmpp/getHistory.xmpp';

/** The slice of the XMPP client the history loader needs. */
export interface HistoryPageClient {
  getHistoryStanza: (
    chatJID: string,
    max: number,
    before?: number,
    id?: string,
    options?: { source?: 'active' | 'send_ack' | 'background' | 'default' }
  ) => Promise<unknown>;
}

/**
 * Where the next page of older history starts when the caller names no
 * anchor: the server's own paging cursor, or the oldest message that carries a
 * numeric archive id, whichever is older. Never a position in the message
 * list: a page made only of receipts or reactions adds nothing to it, so a
 * position keeps pointing at the same message and paging stalls.
 */
export const resolveHistoryBefore = (
  room: Pick<IRoom, 'messages' | 'messageStats'> | undefined,
  explicit?: number
): number | undefined => {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {return explicit;}
  if (!room) {return undefined;}
  const candidates: number[] = [];
  const cursor = room.messageStats?.firstMessageTimestamp;
  if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    candidates.push(cursor);
  }
  for (const message of room.messages ?? []) {
    const id = Number(message.id);
    if (Number.isFinite(id) && id > 0) {candidates.push(id);}
  }
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
};

export interface LoadRoomHistoryParams {
  client: HistoryPageClient | null | undefined;
  /** The room as it is in the store NOW (read at call time, not from a render). */
  room: IRoom | undefined;
  /** Rooms with a request in flight: one request per room at a time. */
  inFlight: Set<string>;
  chatJID: string;
  max: number;
  before?: number;
  /** Told when the first request starts and when the last one ends. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * One page of older history for a room. Always settles and never rejects: a
 * failed page must not leave the room blocked or reject into the caller's
 * chain. Does nothing for a room that is complete, unknown, or already loading.
 */
export async function loadRoomHistory({
  client,
  room,
  inFlight,
  chatJID,
  max,
  before,
  onBusyChange,
}: LoadRoomHistoryParams): Promise<void> {
  if (!client || !chatJID) {return;}
  if (inFlight.has(chatJID)) {return;}
  if (!room || room.historyComplete) {return;}

  const anchor = resolveHistoryBefore(room, before);
  inFlight.add(chatJID);
  onBusyChange?.(true);
  try {
    await client.getHistoryStanza(chatJID, max, anchor, undefined, {
      source: 'active',
    });
  } catch {
    // swallowed on purpose, see above
  } finally {
    inFlight.delete(chatJID);
    onBusyChange?.(inFlight.size > 0);
  }
}

/** Rows read per older page while the room being opened has no message yet. */
export const INITIAL_HISTORY_SKIP_PAGE_SIZE = 100;
/** Older pages read that way at most before the room is shown empty. */
export const MAX_INITIAL_HISTORY_SKIP_PAGES = 20;

/** The slice of the XMPP client the room-opening load needs. */
export interface InitialHistoryClient {
  getHistoryPage: (
    chatJID: string,
    max: number,
    cursor?: { before?: number }
  ) => Promise<HistoryPage>;
}

/**
 * The history of a room being opened: its latest page, then older pages for
 * as long as a page brings no message. A page can hold only receipts, read
 * markers or reactions (archive rows that are no message), and while the
 * room has no message the chat shows "no messages" and nothing pages further
 * (MessageList, which would, is not mounted): the room looked empty until a
 * new message arrived. Stops at the first page with a message, at the start
 * of the archive, at a failed page, or after `maxSkipPages` older pages.
 * Returns the messages of the last page read.
 */
export async function loadInitialRoomHistory(
  client: InitialHistoryClient,
  chatJID: string,
  firstPageSize: number,
  {
    skipPageSize = INITIAL_HISTORY_SKIP_PAGE_SIZE,
    maxSkipPages = MAX_INITIAL_HISTORY_SKIP_PAGES,
  }: { skipPageSize?: number; maxSkipPages?: number } = {}
): Promise<IMessage[]> {
  let page = await client.getHistoryPage(chatJID, firstPageSize);
  for (let skipped = 0; skipped < maxSkipPages; skipped++) {
    const onlyNonMessages =
      page.ok &&
      page.finSeen &&
      !page.complete &&
      page.messages.length === 0 &&
      page.received > 0 &&
      page.first !== null;
    if (!onlyNonMessages) {break;}
    page = await client.getHistoryPage(chatJID, skipPageSize, {
      before: page.first as number,
    });
  }
  return page.messages;
}
