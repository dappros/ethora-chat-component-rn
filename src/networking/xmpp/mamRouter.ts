import { store } from '../../roomStore';
import { addRoomMessages, setReactions } from '../../roomStore/roomsSlice';
import { IMessage } from '../../types/types';
import { applyMamReactions, type ExtractedReaction } from '../../helpers/mamReactions';

interface PendingQuery {
  roomJID: string;
  apply: boolean;
  messages: IMessage[];
  reactions: ExtractedReaction[];
  inflight: number;
  closed: null | { error: boolean };
  resolve: (messages: IMessage[]) => void;
  reject: (error: Error) => void;
}

/**
 * Replay an archived reaction into the store. Flagged `fromHistory` so
 * reactionsMiddleware leaves the room preview alone: a replay must not turn
 * the last real message into an emoji. (setReactions has no prepare(), so
 * the flag is added by hand.)
 */
export const replayArchivedReaction = (
  reaction: ExtractedReaction,
  fallbackRoomJID = ''
) => {
  store.dispatch({
    ...setReactions({
      roomJID: reaction.roomJID || fallbackRoomJID,
      messageId: reaction.messageId,
      from: reaction.from,
      reactions: reaction.emoji,
      data: reaction.data,
      latestReactionTimestamp: reaction.ts,
    }),
    meta: { fromHistory: true },
  });
};

const pending = new Map<string, PendingQuery>();

const flush = (query: PendingQuery) => {
  // Every step is guarded: a failure in one (a middleware throwing on a
  // reaction, say) used to escape `settle` before the waiting request was
  // resolved — the page was lost and the room stayed empty until opened.
  let deferred: ExtractedReaction[] = [];
  try {
    // Reactions ride in the archive as their own entries: fold them onto
    // the page's messages first, so they are stored together.
    deferred = applyMamReactions(query.messages, query.reactions);
  } catch (e) {
    console.warn('[mam] applying reactions to a page failed', e);
  }
  if (query.apply && query.messages.length > 0) {
    try {
      store.dispatch(
        addRoomMessages({ roomJID: query.roomJID, messages: query.messages })
      );
    } catch (e) {
      console.warn('[mam] applying a history page failed', e);
    }
  }
  for (const reaction of deferred) {
    try {
      replayArchivedReaction(reaction, query.roomJID);
    } catch (e) {
      console.warn('[mam] applying a reaction failed', e);
    }
  }
};

export const beginMamQuery = (
  queryId: string,
  roomJID: string,
  apply = true
): Promise<IMessage[]> =>
  new Promise((resolve, reject) => {
    pending.set(queryId, {
      roomJID,
      apply,
      messages: [],
      reactions: [],
      inflight: 0,
      closed: null,
      resolve,
      reject,
    });
  });

/**
 * Give up waiting (timeout). Whatever arrived is still applied — a late
 * page is better than a lost one — and handed back.
 */
export const cancelMamQuery = (queryId: string): IMessage[] => {
  const query = pending.get(queryId);
  if (!query) {return [];}
  pending.delete(queryId);
  flush(query);
  query.resolve(query.messages);
  return query.messages;
};

const bareLower = (jid: unknown): string =>
  String(jid || '').split('/')[0].toLowerCase();

// By the echoed `queryid` when the server provides one; otherwise by the
// room the result came from — the oldest still-open query for that room.
// (Results are per room anyway: a query only ever asks one archive.)
const queryOf = (stanza: any): PendingQuery | undefined => {
  const queryId = stanza?.getChild?.('result')?.attrs?.queryid;
  const byId = queryId ? pending.get(queryId) : undefined;
  if (byId) {return byId;}
  const room = bareLower(stanza?.attrs?.from);
  if (!room) {return undefined;}
  for (const query of pending.values()) {
    if (!query.closed && bareLower(query.roomJID) === room) {return query;}
  }
  return undefined;
};

const settle = (queryId: string, query: PendingQuery) => {
  if (pending.get(queryId) === query) {pending.delete(queryId);}
  try {
    flush(query);
  } finally {
    // The waiting request is always answered, whatever happened above.
    if (query.closed?.error) {
      query.reject(new Error('mam query error'));
    } else {
      query.resolve(query.messages);
    }
  }
};

const settleIfDone = (query: PendingQuery) => {
  if (!query.closed || query.inflight > 0) {return;}
  const entry = [...pending.entries()].find(([, q]) => q === query);
  settle(entry ? entry[0] : '', query);
};

/**
 * Claim a result for its pending query — synchronously, the moment the
 * stanza arrives — so the router knows a parse is outstanding. Returns
 * true when a pending query owns it (the caller must then always follow
 * up with `collectMamMessage`, even when the parse yields nothing).
 */
export const claimMamResult = (stanza: any): boolean => {
  const query = queryOf(stanza);
  if (!query) {return false;}
  query.inflight += 1;
  return true;
};

/** The parsed result of a claimed stanza (undefined: dropped). */
export const collectMamReaction = (
  stanza: any,
  reaction: ExtractedReaction
): boolean => {
  const query = queryOf(stanza);
  if (!query) {return false;}
  query.reactions.push(reaction);
  return true;
};

export const collectMamMessage = (
  stanza: any,
  message: IMessage | undefined
): boolean => {
  const query = queryOf(stanza);
  if (!query) {return false;}
  if (message) {query.messages.push(message);}
  query.inflight = Math.max(0, query.inflight - 1);
  settleIfDone(query);
  return true;
};

/** The query's closing iq; true when it belonged to a pending query. */
export const routeMamIq = (stanza: any): boolean => {
  if (!stanza?.is?.('iq')) {return false;}
  const query = pending.get(stanza.attrs?.id);
  if (!query) {return false;}
  query.closed = { error: stanza.attrs.type === 'error' };
  // Results that are still being parsed settle the page when they land;
  // until then the query stays registered so they can find it.
  if (query.inflight === 0) {settle(stanza.attrs.id, query);}
  return true;
};

/** Test hook. */
export const __resetMamRouter = () => pending.clear();
