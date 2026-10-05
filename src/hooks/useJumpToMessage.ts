import { MutableRefObject, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { RootState } from '../roomStore';
import {
  PendingJump,
  clearJumpWindow,
  clearPendingJump,
  showArchivedMessage,
} from '../roomStore/roomsSlice';
import { IMessage } from '../types/types';
import { toastEmitter } from '../utils/toastEmitter';
import { useT } from '../i18n/useT';
import { JumpContent } from '../helpers/jumpWindow';
import {
  findMessageIndex,
  JUMP_TTL_MS,
  ownerThreadFor,
  replyParentId,
  useJumpThread,
} from '../helpers/jumpThread';
import { HIGHLIGHT_MS } from '../helpers/bubbleHighlight';

export { findMessageIndex, JUMP_TTL_MS, HIGHLIGHT_MS };

// How far back the paging fallback goes before giving up. A request may stay
// alive for JUMP_TTL_MS at all (a room that never finishes opening must not
// leave one armed to fire at some unrelated later moment).
export const MAX_HISTORY_PAGES = 40;
export const JUMP_PAGE_SIZE = 100;
// A page request that fails is retried this many times in a row before the
// history is treated as unreachable.
export const MAX_PAGE_FAILURES = 3;
// A target already in the store and at most this far from the newest message
// is reached by scrolling the live list. Anything farther is fetched as a
// small window around it instead: re-merging a thousand rows to reach it is
// what made a far jump lag.
export const NEAR_LIVE_MESSAGES = 300;
// A jump into a room that is still opening waits this long for its live list
// before it stops waiting for it and asks the archive directly.
export const ROOM_OPENING_GRACE_MS = 4000;
// Pause between checks while waiting for a room that is still opening, and
// how many times a window request that could not be asked is repeated.
export const ROOM_OPENING_POLL_MS = 700;
export const MAX_WINDOW_RETRIES = 6;
// The highlight starts once the list has laid out the rows around the target
// and the scroll (with its retries, see MessageList) has settled.
export const HIGHLIGHT_SETTLE_MS = 450;

/**
 * How the attempt to open a window around the target went:
 *  - found: the window is in the store; the list now renders it;
 *  - missing: the server answered and the target is not in its archive;
 *  - unavailable: could not ask (no archive id, request failed): page instead.
 */
export type WindowFetchResult = 'found' | 'missing' | 'unavailable';

/** What the server said about one page of older history. */
export interface OlderPage {
  /** False when the request failed. */
  ok: boolean;
  /**
   * The RSM `<first>` of the page: the id (microseconds) of the oldest ROW the
   * server returned. The next page continues from here. It is NOT the oldest
   * message that got displayed: a page can be made entirely of receipts or
   * reactions, display nothing, and still be followed by plenty of history.
   */
  cursor?: number | null;
  /** The server's `<fin complete>`: there is nothing older. */
  complete?: boolean;
}

interface Options {
  roomJID: string;
  /** The list's messages in chronological order (oldest first). */
  messages: IMessage[];
  /** The rows the list renders, in render order (newest first when inverted). */
  listData: IMessage[];
  /** Scroll the list to a row of `listData`. */
  scrollToIndex: (index: number) => void;
  /** Highlight the bubble of the message (id) or clear the highlight (null). */
  onHighlight: (messageId: string | null) => void;
  /**
   * Older history through the room's loader. Used for the paging fallback
   * when `fetchOlderPage` is not given.
   */
  loadMoreMessages?: (
    chatJID: string,
    max: number,
    amount?: number
  ) => Promise<void>;
  /**
   * Fetches the next page of older history and resolves once that page is in
   * the store, with the server's own cursor for what it returned.
   */
  fetchOlderPage?: (
    roomJID: string,
    before: number,
    max: number
  ) => Promise<OlderPage>;
  historyComplete?: boolean;
  /**
   * MessageList's "reader is at the bottom" flag. Cleared for the length of a
   * jump: paging older history grows the list, and with the flag set the list
   * would read that as live content and scroll back to the bottom, undoing
   * the jump the moment the target loads.
   */
  isUserAtBottomRef: MutableRefObject<boolean>;
  /** `messages` is a jump window around an earlier target, not the live list. */
  jumpWindowActive?: boolean;
  /**
   * Opens a window around a far target (and puts it in the store). Omitted
   * where windows do not apply (threads); the paging path is used then.
   */
  fetchWindow?: (jump: PendingJump) => Promise<WindowFetchResult>;
  /**
   * Which list this instance is. A jump is fulfilled by exactly one list: the
   * main list, or the thread its target is a reply in. The other instances
   * stay inert for it, so one of them cannot give up (and show the archived
   * card) while the owner is still working.
   */
  scope?: 'main' | { threadId: string };
  /**
   * The room's messages BEFORE the main list's filter (which hides thread
   * replies). Lets the main list recognise a target that is a thread reply.
   */
  allMessages?: IMessage[];
  /**
   * Opens the thread a reply target belongs to (main list only). Resolves true
   * when the thread is open and owns the jump from now on.
   */
  resolveReply?: (jump: PendingJump, reply: IMessage) => Promise<boolean>;
  /**
   * The room is still opening (joining, loading its first history). While it
   * is, a request that cannot be answered yet is waited out, not counted as a
   * failure: the card is for "the server answered and the message is absent".
   */
  roomOpening?: boolean;
}

/**
 * Fulfils a pending "scroll to this message" request for this room.
 *
 * The target can be in one of three places, tried in this order:
 *  1. in the list (virtualised, so mounted or not does not matter) and not
 *     far from the newest message: scroll to its row, then highlight its
 *     bubble;
 *  2. not loaded, or loaded but far back: fetch a short window of the archive
 *     around it (the list shows that instead of the live list) and scroll to
 *     it there;
 *  3. no window possible (no archive id, request failed): page older history
 *     by the server's own cursor until it shows up or the history ends.
 * If the server says the message is not in its archive, show the message
 * itself in a card (a search hit always ends with the message on screen); a
 * request with nothing to show says it could not be found.
 *
 * Exactly one list owns a request (see `scope`).
 */
export function useJumpToMessage({
  roomJID,
  messages,
  listData,
  scrollToIndex,
  onHighlight,
  loadMoreMessages,
  fetchOlderPage,
  historyComplete,
  isUserAtBottomRef,
  jumpWindowActive = false,
  fetchWindow,
  scope = 'main',
  allMessages,
  resolveReply,
  roomOpening = false,
}: Options) {
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const t = useT();
  const jump = useSelector((state: RootState) => state.rooms.pendingJump);
  const jumpThread = useJumpThread();
  const ownerThreadId = ownerThreadFor(jumpThread, jump?.at);
  const scopeThreadId = scope === 'main' ? null : scope.threadId;
  const isOwner =
    scopeThreadId === null
      ? ownerThreadId === null
      : ownerThreadId === scopeThreadId;

  const attemptsRef = useRef(0);
  const loadingRef = useRef(false);
  // Callbacks that change identity on render live in a ref so they do not
  // retrigger the effect below.
  const latest = useRef({
    t,
    loadMoreMessages,
    fetchOlderPage,
    scrollToIndex,
    onHighlight,
    fetchWindow,
    resolveReply,
    allMessages,
    roomOpening,
  });
  latest.current = {
    t,
    loadMoreMessages,
    fetchOlderPage,
    scrollToIndex,
    onHighlight,
    fetchWindow,
    resolveReply,
    allMessages,
    roomOpening,
  };
  const replyResolvedAtRef = useRef<number | null>(null);
  const windowRetriesRef = useRef(0);
  // Per request: whether a window was already tried, and whether the server
  // said the target does not exist.
  const windowTriedAtRef = useRef<number | null>(null);
  const windowMissingAtRef = useRef<number | null>(null);
  const currentJumpAtRef = useRef<number | null>(null);
  currentJumpAtRef.current = jump?.at ?? null;
  // The request whose scroll is already scheduled. Re-runs of the effect must
  // not schedule it a second time.
  const scheduledAtRef = useRef<number | null>(null);
  // Where the next page of older history starts: the server's cursor from the
  // previous page, or (first page) the oldest of what the room already knows.
  const cursorRef = useRef<number | null>(null);
  // The server has nothing older, or paging stopped making progress.
  const exhaustedRef = useRef(false);
  const failuresRef = useRef(0);
  const timersRef = useRef<{
    scroll?: ReturnType<typeof setTimeout>;
    settle?: ReturnType<typeof setTimeout>;
    clear?: ReturnType<typeof setTimeout>;
    retry?: ReturnType<typeof setTimeout>;
  }>({});
  const [tick, setTick] = useState(0);

  useEffect(
    () => () => {
      const timers = timersRef.current;
      if (timers.scroll) {clearTimeout(timers.scroll);}
      if (timers.settle) {clearTimeout(timers.settle);}
      if (timers.clear) {clearTimeout(timers.clear);}
      if (timers.retry) {clearTimeout(timers.retry);}
    },
    []
  );

  // A new request starts its own page budget.
  useEffect(() => {
    attemptsRef.current = 0;
    cursorRef.current = null;
    exhaustedRef.current = false;
    failuresRef.current = 0;
    windowRetriesRef.current = 0;
  }, [jump?.at]);

  useEffect(() => {
    if (!jump || jump.roomJID !== roomJID || !isOwner) {return;}
    isUserAtBottomRef.current = false;

    const finish = (reached: boolean) => {
      dispatch(clearPendingJump());
      if (reached) {return;}

      // Not reachable in the transcript. If the request knows what the
      // message says (every search hit does), show IT, so the tap always ends
      // with the message in front of the reader and nothing that reads as an
      // error. Only a jump with no message to show (a notification or a link)
      // falls back to saying it could not be found.
      if (jump.preview) {
        dispatch(showArchivedMessage(jump.preview));
        return;
      }
      const { t: tr } = latest.current;
      toastEmitter.emit({
        id: `jump-to-message-missing-${Date.now()}`,
        title: tr('search.messages.title'),
        message: tr('search.messages.notFound'),
        type: 'info',
      });
    };

    if (Date.now() - jump.at > JUMP_TTL_MS) {
      // Expired, but the message is in the list: nothing is missing, so no
      // "archived" card.
      finish(
        findMessageIndex(messages, jump.ids, {
          createdAt: jump.createdAt,
          body: jump.body,
        }) >= 0
      );
      return;
    }

    // Waiting on something the store will not announce (a room still opening):
    // look again shortly. The TTL above bounds how long this can go on.
    const recheckSoon = () => {
      if (timersRef.current.retry) {clearTimeout(timersRef.current.retry);}
      timersRef.current.retry = setTimeout(
        () => setTick((value) => value + 1),
        ROOM_OPENING_POLL_MS
      );
    };

    const content: JumpContent = {
      createdAt: jump.createdAt,
      body: jump.body,
    };

    // A target that is a thread reply is not in this (main) list at all: it
    // lives in its parent's thread. Open that thread, which takes the jump over.
    if (
      scopeThreadId === null &&
      latest.current.resolveReply &&
      replyResolvedAtRef.current !== jump.at
    ) {
      const pool = latest.current.allMessages ?? messages;
      const rawIndex = findMessageIndex(pool, jump.ids, content);
      const raw = rawIndex >= 0 ? pool[rawIndex] : null;
      if (raw && replyParentId(raw)) {
        replyResolvedAtRef.current = jump.at;
        loadingRef.current = true;
        const requestedAt = jump.at;
        latest.current
          .resolveReply(jump, raw)
          .catch(() => false)
          .then((opened) => {
            loadingRef.current = false;
            if (currentJumpAtRef.current !== requestedAt) {return;}
            if (!opened) {finish(false);}
            else {setTick((value) => value + 1);}
          });
        return;
      }
    }

    const index = findMessageIndex(messages, jump.ids, content);

    const windowAvailable =
      Boolean(latest.current.fetchWindow) &&
      windowTriedAtRef.current !== jump.at;

    if (
      index >= 0 &&
      (jumpWindowActive ||
        messages.length - index <= NEAR_LIVE_MESSAGES ||
        !windowAvailable)
    ) {
      const targetId = String(messages[index].id);
      const rowIndex = listData.findIndex(
        (message) => String(message.id) === targetId
      );
      // The list has not caught up with the messages yet: look again when it
      // has (this effect re-runs with it).
      if (rowIndex < 0) {return;}
      if (scheduledAtRef.current === jump.at) {return;}
      scheduledAtRef.current = jump.at;

      // Next tick: let the list lay out whatever the room switch, page load or
      // window just handed it before measuring against it. The highlight
      // starts only after the scroll has settled, and its clock starts then.
      timersRef.current.scroll = setTimeout(() => {
        latest.current.scrollToIndex(rowIndex);
        timersRef.current.settle = setTimeout(() => {
          latest.current.onHighlight(targetId);
          timersRef.current.clear = setTimeout(
            () => latest.current.onHighlight(null),
            HIGHLIGHT_MS
          );
        }, HIGHLIGHT_SETTLE_MS);
      }, 0);
      finish(true);
      return;
    }

    // A new request for a message outside the window now on screen: go back
    // to the live list first (this effect re-runs with it).
    if (jumpWindowActive) {
      dispatch(clearJumpWindow());
      return;
    }

    // Not loaded, or loaded but far back. An empty list means the room is
    // still opening: give its live list a moment (the target is usually in it),
    // then ask the archive directly rather than wait for a history that can
    // take ten seconds. The TTL above bounds all of it.
    if (loadingRef.current) {return;}
    if (
      messages.length === 0 &&
      (!latest.current.fetchWindow ||
        (latest.current.roomOpening &&
          Date.now() - jump.at < ROOM_OPENING_GRACE_MS))
    ) {
      recheckSoon();
      return;
    }

    if (windowMissingAtRef.current === jump.at && index < 0) {
      finish(false);
      return;
    }

    // Fetch only a window around the target instead of paging the whole
    // stretch of history between it and the live tail.
    if (windowAvailable && latest.current.fetchWindow) {
      windowTriedAtRef.current = jump.at;
      loadingRef.current = true;
      const requestedAt = jump.at;
      latest.current
        .fetchWindow(jump)
        .catch((): WindowFetchResult => 'unavailable')
        .then((result) => {
          loadingRef.current = false;
          if (currentJumpAtRef.current !== requestedAt) {return;}
          if (result === 'missing') {windowMissingAtRef.current = requestedAt;}
          if (
            result === 'unavailable' &&
            latest.current.roomOpening &&
            windowRetriesRef.current < MAX_WINDOW_RETRIES
          ) {
            // Could not ask yet (connection or room still coming up): ask
            // again, instead of falling back to paging a room with no history.
            windowRetriesRef.current += 1;
            windowTriedAtRef.current = null;
            recheckSoon();
            return;
          }
          setTick((value) => value + 1);
        });
      return;
    }

    if (messages.length === 0) {
      recheckSoon();
      return;
    }

    const firstReal = messages.find(
      (message) => !String(message.id).startsWith('delimiter-new')
    );
    if (!firstReal) {return;}

    if (
      exhaustedRef.current ||
      historyComplete ||
      attemptsRef.current >= MAX_HISTORY_PAGES
    ) {
      finish(false);
      return;
    }

    // Page back through the archive by the server's own cursor. Each request
    // resolves only once its page is in the store, so there is nothing to wait
    // out and no guessing from the list: the answer to "is there more" is the
    // server's, not "did the oldest displayed message change". The first page
    // starts from the server cursor the room already holds when that is
    // older than the oldest displayed message (a page of receipts displays
    // nothing but still moved the cursor).
    const oldestDisplayed = Number(firstReal.id);
    const roomCursor =
      reduxStore.getState().rooms.rooms?.[roomJID]?.messageStats
        ?.firstMessageTimestamp;
    const startFrom =
      typeof roomCursor === 'number' &&
      Number.isFinite(roomCursor) &&
      (!Number.isFinite(oldestDisplayed) || roomCursor < oldestDisplayed)
        ? roomCursor
        : oldestDisplayed;
    const before = cursorRef.current ?? startFrom;
    if (!Number.isFinite(before)) {
      finish(false);
      return;
    }
    attemptsRef.current += 1;
    loadingRef.current = true;

    const fetchPage: (
      jid: string,
      from: number,
      max: number
    ) => Promise<OlderPage> =
      latest.current.fetchOlderPage ??
      (async (jid, from, max) => {
        const loadMore = latest.current.loadMoreMessages;
        if (!loadMore) {return { ok: false };}
        await loadMore(jid, max, from);
        const room = reduxStore.getState().rooms.rooms?.[jid];
        return {
          ok: true,
          cursor: room?.messageStats?.firstMessageTimestamp,
          complete: Boolean(room?.historyComplete),
        };
      });

    fetchPage(roomJID, before, JUMP_PAGE_SIZE)
      .catch((): OlderPage => ({ ok: false }))
      .then((page) => {
        loadingRef.current = false;
        if (!page.ok) {
          // A room that is still opening cannot answer yet: that is not the
          // history being unreachable, so it does not count.
          if (latest.current.roomOpening) {
            recheckSoon();
            return;
          }
          failuresRef.current += 1;
          if (failuresRef.current >= MAX_PAGE_FAILURES) {
            exhaustedRef.current = true;
          }
        } else {
          failuresRef.current = 0;
          if (page.complete) {exhaustedRef.current = true;}
          if (typeof page.cursor === 'number' && page.cursor < before) {
            cursorRef.current = page.cursor;
          } else if (!page.complete) {
            // Same cursor back: this page made no progress, and asking again
            // would repeat it forever.
            exhaustedRef.current = true;
          }
        }
        setTick((value) => value + 1);
      });
  }, [
    jump,
    roomJID,
    messages,
    listData,
    historyComplete,
    jumpWindowActive,
    tick,
    isOwner,
    scopeThreadId,
    isUserAtBottomRef,
    dispatch,
    reduxStore,
  ]);
}
