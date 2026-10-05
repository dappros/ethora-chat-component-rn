import type { IRoom } from '../types/types';

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
