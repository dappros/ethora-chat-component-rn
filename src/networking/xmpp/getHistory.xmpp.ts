import { Client, xml } from '@xmpp/client';
import { Element } from 'ltx';
import { IMessage } from '../../types/types';
import { store } from '../../roomStore';
import { setReactions } from '../../roomStore/roomsSlice';
import { getDataFromXml } from '../../helpers/getDataFromXml';
import { createMessageFromXml } from '../../helpers/createMessageFromXml';
import { transformCallLogMessage } from '../../helpers/callLogMessage';
import { applyMamReactions } from '../../helpers/mamReactions';
import { getBooleanFromString } from '../../helpers/getBooleanFromString';
import { getNumberFromString } from '../../helpers/getNumberFromString';
import { WINDOW_QUERY_PREFIX } from './mamQueryIds';
import {
  applyHistoryPageCursor,
  snapshotRoomHistory,
} from './historyCursor';

/** Where a page is read from. Nothing set means the latest page. */
export interface HistoryPageCursor {
  /** Page ending just before this archive id (exclusive). */
  before?: number;
  /** Page starting just after this archive id (exclusive). */
  after?: number;
  /**
   * MAM time filter (ISO strings). With one and no before/after cursor the
   * server answers with the FIRST page of the filtered range, oldest first,
   * which is how a row with no archive id is located by its time.
   */
  start?: string;
  end?: string;
}

/** One archive page together with what the server's `<fin>` said about it. */
export interface HistoryPage {
  ok: boolean;
  /** Oldest first, reactions merged on, reaction stanzas themselves left out. */
  messages: IMessage[];
  /** `<fin complete>`: nothing further in the direction that was paged. */
  complete: boolean;
  /** RSM `<first>`: archive id of the first row of the page, null when unknown. */
  first: number | null;
  /** RSM `<last>`: archive id of the last row of the page, null when unknown. */
  last: number | null;
  /** RSM `<count>`: size of the whole (filtered) archive when the server says. */
  count: number | null;
  /** Result stanzas the page carried, receipts and reactions included. */
  received: number;
  /** `<fin>` was present in the answer. */
  finSeen: boolean;
  /** Full room JID the query was addressed to. */
  roomJid: string;
}

export interface HistoryPageOptions extends HistoryPageCursor {
  /** Query id; a default unique one is made when absent. */
  id?: string;
  /**
   * Isolated query: tagged so the global handlers skip its results, never
   * touches the room's cursor. Implied by after/start/end.
   */
  window?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;
const WINDOW_TIMEOUT_MS = 8000;

let querySeq = 0;
const nextQueryId = (prefix: string) => {
  querySeq = (querySeq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString()}:${querySeq}`;
};

/**
 * If a caller passes a bare local-part (no `@host`), pick a default conference
 * based on the client's actual service URL, never leak a hard-coded dev domain.
 */
const toConferenceJid = (client: Client, chatJID: string): string =>
  chatJID.includes('@')
    ? chatJID
    : (() => {
        const service: string = (client as any)?.options?.service || '';
        const host =
          service.match(/wss?:\/\/([^:/]+)/)?.[1] || 'xmpp.chat.ethora.com';
        return `${chatJID}@conference.${host}`;
      })();

const emptyPage = (roomJid: string, ok = false): HistoryPage => ({
  ok,
  messages: [],
  complete: false,
  first: null,
  last: null,
  count: null,
  received: 0,
  finSeen: false,
  roomJid,
});

const warnRowSkipped = (error: unknown) => {
  // One row the parser cannot handle must not cost the whole page.
  console.log('history row skipped', error);
};

const parseRows = async (rows: Element[]): Promise<IMessage[]> => {
  const parsed: IMessage[] = [];
  // Reaction stanzas carry <reactions> but no body: they update their target
  // message and are not rendered as messages of their own.
  const reactionStanzas: Element[] = [];

  for (const msg of rows) {
    try {
      if (msg?.getChild('reactions')) {
        reactionStanzas.push(msg);
        continue;
      }
      const text = msg.getChild('body')?.getText();
      if (!text) continue;

      const result = await getDataFromXml(msg);
      if (!result) continue;
      const { data, id, body, ...rest } = result;
      if (!data) continue;

      const raw = await createMessageFromXml({
        data,
        id,
        body: body || '',
        ...rest,
      } as any);
      // Server `call-state` archives become friendly call-log entries, the
      // way the live path turns them.
      parsed.push(
        transformCallLogMessage(
          raw,
          store.getState().chatSettingStore.user?.xmppUsername || ''
        )
      );
    } catch (error) {
      warnRowSkipped(error);
    }
  }

  // Reactions whose target is in this page are merged onto it; the rest are
  // replayed into the store (the target may be in an earlier page or live).
  const { deferred } = applyMamReactions(parsed, reactionStanzas);
  for (const reaction of deferred) {
    // A store failure on one reaction must not fail the whole archive page.
    try {
      store.dispatch({
        ...setReactions(reaction),
        meta: { fromHistory: true },
      });
    } catch (error) {
      warnRowSkipped(error);
    }
  }
  return parsed;
};

const buildMamQuery = (
  to: string,
  id: string,
  max: number,
  cursor: HistoryPageCursor
) => {
  const timeFilter = cursor.start || cursor.end;
  return xml(
    'iq',
    { type: 'set', to, id },
    xml(
      'query',
      { xmlns: 'urn:xmpp:mam:2', queryid: id },
      timeFilter
        ? xml(
            'x',
            { xmlns: 'jabber:x:data', type: 'submit' },
            xml(
              'field',
              { var: 'FORM_TYPE', type: 'hidden' },
              xml('value', {}, 'urn:xmpp:mam:2')
            ),
            cursor.start
              ? xml('field', { var: 'start' }, xml('value', {}, cursor.start))
              : null,
            cursor.end
              ? xml('field', { var: 'end' }, xml('value', {}, cursor.end))
              : null
          )
        : null,
      xml(
        'set',
        { xmlns: 'http://jabber.org/protocol/rsm' },
        xml('max', {}, max.toString()),
        cursor.after !== undefined
          ? xml('after', {}, String(cursor.after))
          : cursor.before
            ? xml('before', {}, cursor.before.toString())
            : timeFilter
              ? null
              : xml('before')
      )
    )
  );
};

/**
 * One MAM page, read and parsed, with the RSM bounds of the answer. Always
 * settles: a timeout or an iq error gives `ok: false` and no messages. It
 * stores nothing (reactions aside); the callers decide what a page means.
 */
export const fetchHistoryPage = async (
  client: Client,
  chatJID: string,
  max: number,
  options: HistoryPageOptions = {}
): Promise<HistoryPage> => {
  const roomJid =
    typeof chatJID === 'string' ? toConferenceJid(client, chatJID) : '';
  if (!roomJid) return emptyPage('');

  const isWindow =
    options.window === true ||
    options.after !== undefined ||
    !!options.start ||
    !!options.end;
  const id =
    options.id ??
    nextQueryId(isWindow ? WINDOW_QUERY_PREFIX : 'get-history:');
  const timeoutMs =
    options.timeoutMs ?? (isWindow ? WINDOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  let stanzaHdlr: ((stanza: any) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<HistoryPage>((resolve) => {
      const rows: Element[] = [];
      let received = 0;
      let settled = false;
      const settle = (page: HistoryPage) => {
        if (settled) return;
        settled = true;
        resolve(page);
      };

      stanzaHdlr = async (stanza: any) => {
        try {
          if (stanza?.is?.('message') && stanza.attrs?.from) {
            const result = stanza.getChild('result');
            if (result) {
              const queryId = result.attrs?.queryid;
              // Our own queries echo their id: results of a sibling request
              // for the same room (another page, a window) are not ours.
              const mine = queryId
                ? queryId === id
                : String(stanza.attrs.from).startsWith(roomJid);
              if (mine) {
                received += 1;
                const row = result.getChild('forwarded')?.getChild('message');
                if (row) rows.push(row);
              }
            }
          }

          if (
            stanza?.is?.('iq') &&
            stanza.attrs?.id === id &&
            stanza.attrs?.type === 'result'
          ) {
            const fin = stanza.getChild('fin');
            const set = fin?.getChild?.('set');
            const first = set?.getChildText?.('first');
            const last = set?.getChildText?.('last');
            const count = set?.getChildText?.('count');
            const messages = await parseRows(rows);
            settle({
              ok: true,
              messages,
              complete: getBooleanFromString(fin?.attrs?.complete) === true,
              first: first ? getNumberFromString(first) : null,
              last: last ? getNumberFromString(last) : null,
              count: count ? getNumberFromString(count) : null,
              received,
              finSeen: !!fin,
              roomJid,
            });
          }

          if (
            stanza?.is?.('iq') &&
            stanza.attrs?.id === id &&
            stanza.attrs?.type === 'error'
          ) {
            // No history yet in a fresh room answers with an error: expected.
            settle(emptyPage(roomJid));
          }
        } catch (error) {
          warnRowSkipped(error);
          settle(emptyPage(roomJid));
        }
      };

      client?.on('stanza', stanzaHdlr);
      timer = setTimeout(() => settle(emptyPage(roomJid)), timeoutMs);

      Promise.resolve(
        client?.send(buildMamQuery(roomJid, id, max, options))
      ).catch((err: any) => {
        console.log('err on load', err);
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (stanzaHdlr) client?.off('stanza', stanzaHdlr);
  }
};

/**
 * One page of the room's live history: like fetchHistoryPage, and when the
 * page feeds the live list (the latest page, or the one before a cursor) the
 * room's paging cursor follows the server's `<fin>`. A page read by `after`,
 * a time filter or flagged `window` is an isolated query and writes nothing.
 */
export const getHistoryPage = async (
  client: Client,
  chatJID: string,
  max: number,
  options: HistoryPageOptions = {}
): Promise<HistoryPage> => {
  if (typeof chatJID !== 'string') return emptyPage('');
  const isolated =
    options.window === true ||
    options.after !== undefined ||
    !!options.start ||
    !!options.end;
  if (isolated) {
    return fetchHistoryPage(client, chatJID, max, { ...options, window: true });
  }
  const snapshot = snapshotRoomHistory(toConferenceJid(client, chatJID));
  const page = await fetchHistoryPage(client, chatJID, max, options);
  if (page.ok) {
    try {
      applyHistoryPageCursor(page, { before: options.before, max }, snapshot);
    } catch (error) {
      warnRowSkipped(error);
    }
  }
  return page;
};

export const getHistory = async (
  client: Client,
  chatJID: string,
  max: number,
  before?: number,
  otherId?: string
): Promise<IMessage[] | undefined> => {
  if (typeof chatJID !== 'string') {return;}
  const page = await getHistoryPage(client, chatJID, max, {
    before,
    id: otherId,
  });
  return page.messages;
};
