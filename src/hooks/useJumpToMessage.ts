import { MutableRefObject, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../roomStore';
import { clearPendingJump } from '../roomStore/roomsSlice';
import { IMessage } from '../types/types';
import { toastEmitter } from '../utils/toastEmitter';
import { useT } from '../i18n/useT';
import { findMessageIndex } from '../helpers/jumpToMessage';

// How far back a jump will page before giving up, and how long a request may
// stay alive at all (a room that never finishes opening must not leave one
// armed to fire at some unrelated later moment).
export const MAX_HISTORY_PAGES = 25;
export const JUMP_PAGE_SIZE = 50;
export const JUMP_TTL_MS = 30_000;
// How long after a page request resolves the oldest message must stay the
// same before the archive is called exhausted: the delivered messages reach
// the list a beat AFTER the request's promise resolves, so an immediate
// comparison reads the old list.
export const EXHAUSTED_GRACE_MS = 1500;
const HIGHLIGHT_MS = 2000;

interface Options {
  roomJID: string;
  /** The room's messages in chronological order (oldest first). */
  messages: IMessage[];
  /** The rows the list renders, in render order (newest first when inverted). */
  listData: IMessage[];
  /** Scroll the list to a row of `listData`. */
  scrollToIndex: (index: number) => void;
  /** Flash the message so the reader can see which one it is. */
  onHighlight: (messageId: string | null) => void;
  loadMoreMessages: (
    chatJID: string,
    max: number,
    amount?: number
  ) => Promise<void>;
  historyComplete?: boolean;
  /**
   * MessageList's "reader is at the bottom" flag. Cleared for the length of a
   * jump: paging older history grows the list, and with the flag set the list
   * would read that as live content and scroll back to the bottom, undoing
   * the jump the moment the target loads.
   */
  isUserAtBottomRef: MutableRefObject<boolean>;
}

/**
 * Fulfils a pending "scroll to this message" request for this room.
 *
 * The target can be in one of two places:
 *  1. in the store (the list is virtualised, so mounted or not does not
 *     matter): scroll to its row and flash it. The web SDK has to widen a
 *     render window first; RN's FlatList renders around the scroll offset by
 *     itself, so the nearest equivalent is MessageList's
 *     onScrollToIndexFailed retry;
 *  2. not loaded at all: page older history from the server until it shows
 *     up, bounded by MAX_HISTORY_PAGES and by the end of the archive.
 * If it cannot be reached, say so rather than leaving the tap looking dead.
 */
export function useJumpToMessage({
  roomJID,
  messages,
  listData,
  scrollToIndex,
  onHighlight,
  loadMoreMessages,
  historyComplete,
  isUserAtBottomRef,
}: Options) {
  const dispatch = useDispatch();
  const t = useT();
  const jump = useSelector((state: RootState) => state.rooms.pendingJump);

  const attemptsRef = useRef(0);
  const loadingRef = useRef(false);
  // Callbacks that change identity on render live in a ref so they do not
  // retrigger the effect below.
  const latest = useRef({
    t,
    loadMoreMessages,
    scrollToIndex,
    onHighlight,
  });
  latest.current = {
    t,
    loadMoreMessages,
    scrollToIndex,
    onHighlight,
  };
  // The request whose scroll is already scheduled. Re-runs of the effect must
  // not schedule it a second time.
  const scheduledAtRef = useRef<number | null>(null);
  // The oldest message id a finished page request started from, compared on
  // the NEXT render with what that request actually delivered.
  const awaitingCheckRef = useRef<string | null>(null);
  const graceElapsedRef = useRef(false);
  // An unchanged oldest message may just mean the page request was swallowed
  // (the room's own scroll-triggered load was already running and the
  // loader ignores overlapping calls), so one empty page is retried before
  // the archive is called exhausted.
  const emptyPagesRef = useRef(0);
  const timersRef = useRef<{
    scroll?: ReturnType<typeof setTimeout>;
    clear?: ReturnType<typeof setTimeout>;
    grace?: ReturnType<typeof setTimeout>;
  }>({});
  const [tick, setTick] = useState(0);

  useEffect(
    () => () => {
      const timers = timersRef.current;
      if (timers.scroll) {clearTimeout(timers.scroll);}
      if (timers.clear) {clearTimeout(timers.clear);}
      if (timers.grace) {clearTimeout(timers.grace);}
    },
    []
  );

  // A new request starts its own page budget.
  useEffect(() => {
    attemptsRef.current = 0;
    emptyPagesRef.current = 0;
    awaitingCheckRef.current = null;
    graceElapsedRef.current = false;
  }, [jump?.at]);

  useEffect(() => {
    if (!jump || jump.roomJID !== roomJID) {return;}
    isUserAtBottomRef.current = false;

    const finish = (reached: boolean) => {
      dispatch(clearPendingJump());
      if (!reached) {
        const { t: tr } = latest.current;
        toastEmitter.emit({
          id: `jump-to-message-missing-${Date.now()}`,
          title: tr('search.messages.title'),
          message: tr('search.messages.notFound'),
          type: 'info',
        });
      }
    };

    if (Date.now() - jump.at > JUMP_TTL_MS) {
      finish(false);
      return;
    }

    const content = { createdAt: jump.createdAt, body: jump.body };
    const rowIndex = findMessageIndex(listData, jump.ids, content);

    if (rowIndex >= 0) {
      if (scheduledAtRef.current === jump.at) {return;}
      scheduledAtRef.current = jump.at;

      const targetId = String(listData[rowIndex].id);
      // Next tick: let the list lay out whatever the room switch / page
      // load just handed it before measuring against it.
      timersRef.current.scroll = setTimeout(() => {
        latest.current.scrollToIndex(rowIndex);
        latest.current.onHighlight(targetId);
        timersRef.current.clear = setTimeout(
          () => latest.current.onHighlight(null),
          HIGHLIGHT_MS
        );
      }, 0);
      finish(true);
      return;
    }

    // Not loaded. An empty list means the room is still opening; the TTL
    // above bounds the wait.
    if (messages.length === 0 || loadingRef.current) {return;}

    const firstReal = messages.find(
      (message) => !String(message.id).startsWith('delimiter-new')
    );
    if (!firstReal) {return;}

    // A page finished and the oldest message is still the one it started
    // from: there is nothing older to fetch, so the target is not in the
    // history and paging again would repeat the same empty request.
    if (awaitingCheckRef.current !== null) {
      if (awaitingCheckRef.current !== String(firstReal.id)) {
        awaitingCheckRef.current = null;
        graceElapsedRef.current = false;
        emptyPagesRef.current = 0;
        if (timersRef.current.grace) {clearTimeout(timersRef.current.grace);}
      } else if (graceElapsedRef.current) {
        if (emptyPagesRef.current >= 1) {
          finish(false);
          return;
        }
        emptyPagesRef.current += 1;
        awaitingCheckRef.current = null;
        graceElapsedRef.current = false;
      } else {
        return;
      }
    }

    if (attemptsRef.current >= MAX_HISTORY_PAGES || historyComplete) {
      finish(false);
      return;
    }

    attemptsRef.current += 1;
    loadingRef.current = true;
    const firstIdBefore = String(firstReal.id);

    latest.current
      .loadMoreMessages(roomJID, JUMP_PAGE_SIZE, Number(firstReal.id))
      .catch(() => undefined)
      .finally(() => {
        loadingRef.current = false;
        awaitingCheckRef.current = firstIdBefore;
        graceElapsedRef.current = false;
        timersRef.current.grace = setTimeout(() => {
          graceElapsedRef.current = true;
          setTick((value) => value + 1);
        }, EXHAUSTED_GRACE_MS);
        setTick((value) => value + 1);
      });
  }, [jump, roomJID, messages, listData, historyComplete, tick, isUserAtBottomRef, dispatch]);
}
