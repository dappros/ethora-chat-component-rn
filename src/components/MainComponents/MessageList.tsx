/** @format */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableOpacity,
  ImageSourcePropType,
} from 'react-native';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { IMessage, User, IConfig, IRoom } from '../../types/types';
import {
  PendingJump,
  appendJumpWindowMessages,
  clearJumpWindow,
  msgSortableMs,
  prependJumpWindowMessages,
  setJumpWindow,
} from '../../roomStore/roomsSlice';
import { RootState } from '../../roomStore';
import Composing from '../styled/StyledInputComponents/Composing';
import TreadLabel from '../styled/TreadLabel';
import { MessageContainer } from './MessageContainer';
import Loader from '../styled/Loader';
import { ArowDownIcon } from '../../assets/icons';
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';
import { getIconColor } from '../../helpers/getIconColor';
import { getChatBackgroundColor } from '../../helpers/getChatBackground';
import { useTheme } from '../../hooks/useTheme';
import { isOwnMessage } from '../../helpers/isOwnMessage';
import {
  OlderPage,
  WindowFetchResult,
  useJumpToMessage,
} from '../../hooks/useJumpToMessage';
import { scrollRetryOffset } from '../../helpers/jumpToMessage';
import {
  HistoryWindowClient,
  loadJumpWindow,
  loadNewerWindowPage,
  loadOlderWindowPage,
} from '../../helpers/jumpWindow';
import {
  mergeById,
  replyParentId,
  useJumpThread,
} from '../../helpers/jumpThread';
import { openThreadForJump } from '../../helpers/openThreadForJump';
import { setBubbleHighlight } from '../../helpers/bubbleHighlight';
import { requestSendersOf } from '../../helpers/userResolver';
import { useT } from '../../i18n/useT';

// Older history is requested while the reader is still this far from the top
// (or 3 screens, whichever is more), so a normal scroll finds it already there
// and never sees a spinner. The spinner is for a reader who outruns the
// request and reaches the very top while it is in flight.
export const PREFETCH_MIN_DISTANCE = 1200;
export const PREFETCH_SCREENS = 3;
// FlatList's own trigger distance, in screens: generous on purpose.
const END_REACHED_THRESHOLD = 4;
export const HISTORY_PAGE_SIZE = 100;
// Consecutive history pages that added nothing to the list before auto-paging
// stops (a reader scroll re-arms it).
export const MAX_IDLE_AUTO_PAGES = 40;
// A request that settled without moving the oldest message or the cursor gets
// exactly one more try after this long.
export const NO_PROGRESS_RETRY_MS = 1000;
const AUTO_FILL_DELAY_MS = 100;
// After a page lands, the content size change it causes is not new content.
const GROWTH_GUARD_MS = 500;
// A window page that failed is not retried in a hot loop.
export const WINDOW_RETRY_AFTER_FAILURE_MS = 3000;
// The scroll that centres the target must not be read as the reader scrolling
// toward an edge (it would page, or leave the window).
export const WINDOW_SETTLE_MS = 600;
export const WINDOW_EXIT_GRACE_MS = 1500;

/** The slice of the XMPP client the list needs. */
export interface MessageListClient extends HistoryWindowClient {
  getHistoryStanza: (
    chatJID: string,
    max: number,
    before?: number,
    id?: string,
    options?: { source?: 'active' | 'send_ack' | 'background' | 'default' }
  ) => Promise<unknown>;
}

interface MessageListProps<TMessage extends IMessage> {
  CustomMessage?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
  }>;
  CustomDaySeparator?: React.ComponentType<{
    date: Date;
    formattedDate: string;
  }>;
  CustomNewMessageLabel?: React.ComponentType<{
    color?: string;
  }>;
  user: User;
  roomJID: string;
  loadMoreMessages: (
    chatJID: string,
    max: number,
    amount?: number
  ) => Promise<void>;
  loading: boolean;
  config?: IConfig;
  isReply: boolean;
  activeMessage?: IMessage;
  /**
   * The XMPP client, for the jump window (archive pages around a far search
   * hit) and the paging fallback of a jump. Without one the list still works
   * and jumps page through the room's own loader.
   */
  client?: MessageListClient | null;
  /**
   * Fired whenever the "read up to" boundary changes: `null` while the
   * user is at the bottom (everything is read), or the timestamp of the
   * newest message they'd actually seen when they scrolled away from it.
   * Lets the host mark only what was actually viewed as read instead of
   * stamping "now" on unmount/leave, which would wrongly clear unread
   * messages the user scrolled up and never got back down to.
   */
  onReadBoundaryChange?: (boundaryTs: number | null) => void;
}

const mainIdCache = new WeakMap<object, string | null>();
const mainMessageIdOf = (m: IMessage): string | null => {
  if (!m?.mainMessage) {return null;}
  const cached = mainIdCache.get(m);
  if (cached !== undefined) {return cached;}
  let id: string | null = null;
  try {
    const parsed = JSON.parse(m.mainMessage);
    id = parsed?.id != null ? String(parsed.id) : null;
  } catch {
    id = null;
  }
  mainIdCache.set(m, id);
  return id;
};

const sortKeyCache = new WeakMap<object, number>();
const sortKeyOf = (m: IMessage): number => {
  const cached = sortKeyCache.get(m);
  if (cached !== undefined) {return cached;}
  const key = new Date(m?.date as any).getTime() || 0;
  sortKeyCache.set(m, key);
  return key;
};

const dayKeyCache = new WeakMap<object, string>();
const dayKeyOf = (m: IMessage): string => {
  const cached = dayKeyCache.get(m);
  if (cached !== undefined) {return cached;}
  const key = new Date(m.date).toDateString();
  dayKeyCache.set(m, key);
  return key;
};

const keyExtractor = (item: IMessage) => String(item.id);
const EMPTY_LIST: IMessage[] = [];

const MessageList = <TMessage extends IMessage>({
  CustomMessage,
  CustomDaySeparator,
  CustomNewMessageLabel,
  user,
  loadMoreMessages,
  roomJID,
  config,
  loading,
  isReply,
  activeMessage,
  client,
  onReadBoundaryChange,
}: MessageListProps<TMessage>) => {
  const room = useSelector(
    (state: RootState) => state.rooms.rooms?.[roomJID]
  ) as IRoom | undefined;
  const composing = room?.composing;
  const composingList = room?.composingList;
  const messages = room?.messages || EMPTY_LIST;
  const historyComplete = room?.historyComplete;
  const theme = useTheme();
  const t = useT();
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Count of messages that arrived while the user was scrolled up.
  // Renders as a badge on the scroll-to-bottom arrow so they know how
  // much they're missing without having to scroll to find out.
  const [unreadWhileScrolledUp, setUnreadWhileScrolledUp] = useState(0);
  // Newest message timestamp at the moment the user scrolled away from
  // the bottom. The badge counts only messages NEWER than this, so
  // back-pagination (loading OLDER history while scrolled up) never
  // inflates the count. Was previously a message-COUNT snapshot, which
  // wrongly counted back-paginated old messages as "new" (Android repro).
  const newestSeenTsRef = useRef<number | null>(null);
  // Refs mirror the viewport state synchronously. The auto-follow logic
  // runs from FlatList callbacks where setState hasn't necessarily
  // committed yet; relying on stale React state is what caused the chat
  // to jump back to the bottom when a new message landed mid-scroll.
  const isUserAtBottomRef = useRef(true);
  const hasUserScrolledRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const flatListRef = useRef<FlatList<IMessage>>(null);

  // Viewport metrics, kept in refs: the loaders read them from timers and
  // FlatList callbacks, never from a stale render closure.
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);

  // A short slice of archive around a far jump target, shown instead of the
  // live list until the reader returns to the latest messages. Not for threads.
  const jumpWindow = useSelector((state: RootState) => state.rooms.jumpWindow);
  const joiningRoomJID = useSelector((state: RootState) =>
    typeof state.rooms.joiningRoomJID === 'string'
      ? state.rooms.joiningRoomJID
      : null
  );
  const windowActive = !isReply && jumpWindow?.roomJID === roomJID;
  const windowActiveRef = useRef(windowActive);
  windowActiveRef.current = windowActive;
  const loadingPropRef = useRef(loading);
  loadingPropRef.current = loading;

  // A thread list also sees what a jump to one of its replies brought in (and
  // any window on screen): those replies may be older than the live list.
  const jumpThread = useJumpThread();
  const threadExtras = useMemo(() => {
    if (!isReply || !activeMessage) {return null;}
    const fromWindow =
      jumpWindow?.roomJID === roomJID ? jumpWindow.messages : [];
    const fromJump =
      jumpThread &&
      jumpThread.roomJID === roomJID &&
      jumpThread.parentId === String(activeMessage.id)
        ? jumpThread.replies
        : [];
    if (fromWindow.length === 0 && fromJump.length === 0) {return null;}
    return mergeById(fromWindow, fromJump);
  }, [isReply, activeMessage, jumpWindow, jumpThread, roomJID]);

  const sourceMessages: IMessage[] = useMemo(() => {
    if (windowActive && jumpWindow) {return jumpWindow.messages;}
    if (threadExtras) {return mergeById(messages ?? [], threadExtras);}
    return messages;
  }, [windowActive, jumpWindow, threadExtras, messages]);

  const addReplyMessages = useMemo(() => {
    // Index replies by their parent once instead of filtering the whole list
    // per message. Only a message that has replies is copied, so the others
    // keep their identity (memoized rows do not re-render).
    const repliesByParent = new Map<string, IMessage[]>();
    for (const mess of sourceMessages) {
      if (!mess?.mainMessage || mess.isDeleted) {continue;}
      const parentId = mainMessageIdOf(mess);
      if (!parentId) {continue;}
      const list = repliesByParent.get(parentId);
      if (list) {
        list.push(mess);
      } else {
        repliesByParent.set(parentId, [mess]);
      }
    }
    if (repliesByParent.size === 0) {return sourceMessages;}
    return sourceMessages.map((message: IMessage) => {
      const reply = repliesByParent.get(String(message.id));
      return reply ? { ...message, reply } : message;
    });
  }, [sourceMessages]);

  const memoizedMessages = useMemo(() => {
    const nonDeletedMessages = addReplyMessages.filter(
      (item: IMessage) => !item.isDeleted
    );

    let filtered: IMessage[];
    if (isReply) {
      filtered = nonDeletedMessages.filter(
        (item: IMessage) =>
          item.roomJid === roomJID &&
          item.isReply &&
          item.isReply === 'true' &&
          item.mainMessage &&
          mainMessageIdOf(item) === String(activeMessage?.id)
      );
    } else {
      filtered = nonDeletedMessages.filter(
        (item: IMessage) =>
          item.showInChannel === 'true' ||
          ((!item.isReply || item.isReply === 'false') && !item.mainMessage)
      );
    }

    // Explicit chronological sort by stanza-id timestamp (microseconds-
    // since-epoch encoded in the id). Without this, MAM history that
    // streams in across multiple ticks visibly reorders itself:
    // insertMessageWithDelimiter inserts new arrivals at the slot
    // matching their date.toString() comparison, but redux state can
    // emit intermediate snapshots between dispatches, so the FlatList
    // briefly renders messages out-of-order until the final batch
    // settles. Sorting here makes each render a stable, ordered view,
    // even mid-stream, so the user sees them appear from oldest to
    // newest with no swap animation.
    let sorted = filtered;
    for (let i = 1; i < filtered.length; i++) {
      if (sortKeyOf(filtered[i - 1]) > sortKeyOf(filtered[i])) {
        sorted = filtered.slice().sort((a, b) => sortKeyOf(a) - sortKeyOf(b));
        break;
      }
    }
    const seen = new Set<string>();
    const deduped: IMessage[] = [];
    for (const m of sorted) {
      const key = String(m.id);
      if (seen.has(key)) {continue;}
      seen.add(key);
      deduped.push(m);
    }
    return deduped;
  }, [addReplyMessages, isReply, roomJID, activeMessage]);
  const memoizedMessagesRef = useRef(memoizedMessages);
  memoizedMessagesRef.current = memoizedMessages;

  // ---------------------------------------------------------------------
  // History loading (live list)
  // ---------------------------------------------------------------------

  const isLoadingMoreRef = useRef(false);
  const growthGuardUntilRef = useRef(0);
  // The request key (oldest displayed message + cursor) last kicked off.
  // Guards against a busy loop: a short conversation that never fills the
  // viewport keeps asking, and a request that settles without moving anything
  // would be asked again immediately, forever.
  const lastRequestedKeyRef = useRef<string | null>(null);
  const idleLoadsRef = useRef(0);
  const idleLoadsLenRef = useRef(-1);
  // Request keys that already got their one delayed retry.
  const retriedKeysRef = useRef<Set<string>>(new Set());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkLoadMoreRef = useRef<(assumeNear?: boolean) => void>(() => {});
  const checkWindowLoadMoreRef = useRef<(fromUserScroll?: boolean) => void>(
    () => {}
  );

  // The paging cursor moved (or regressed through another path) or the
  // history completed: the repeat guard no longer describes the room, so a key
  // seen before is allowed again. The idle page cap still bounds any loop.
  const pagingCursor = useSelector(
    (state: RootState) =>
      state.rooms.rooms[roomJID]?.messageStats?.firstMessageTimestamp
  );
  const roomHistoryComplete = useSelector((state: RootState) =>
    Boolean(state.rooms.rooms[roomJID]?.historyComplete)
  );
  useEffect(() => {
    lastRequestedKeyRef.current = null;
    retriedKeysRef.current = new Set();
  }, [pagingCursor, roomHistoryComplete]);

  useEffect(() => {
    // A new room's oldest message is unrelated to whatever the previous room
    // last attempted: do not let a stale guard block its first load.
    lastRequestedKeyRef.current = null;
    retriedKeysRef.current = new Set();
    idleLoadsRef.current = 0;
    idleLoadsLenRef.current = -1;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [roomJID]);

  useEffect(
    () => () => {
      if (retryTimerRef.current) {clearTimeout(retryTimerRef.current);}
      if (autoFillTimerRef.current) {clearTimeout(autoFillTimerRef.current);}
    },
    []
  );

  const prefetchDistance = () =>
    Math.max(PREFETCH_MIN_DISTANCE, viewportHeightRef.current * PREFETCH_SCREENS);
  // Inverted list: offset 0 is the newest end; older history is at the far end.
  const distanceToOlderEdge = () =>
    contentHeightRef.current - viewportHeightRef.current - scrollOffsetRef.current;

  // After a request settled, if the guard still holds the same key nothing
  // moved (oldest id and cursor identical). Allow exactly one retry per key
  // after ~1 s, then stay stopped until the cursor, historyComplete or the
  // room changes (those clear the retried set).
  const scheduleNoProgressRetry = useCallback(
    (key: string) => {
      if (retriedKeysRef.current.has(key)) {return;}
      if (retryTimerRef.current) {clearTimeout(retryTimerRef.current);}
      const forRoom = roomJID;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (forRoom !== roomJID || !mountedRef.current) {return;}
        if (lastRequestedKeyRef.current !== key) {return;}
        if (reduxStore.getState().rooms.rooms[forRoom]?.historyComplete) {return;}
        retriedKeysRef.current.add(key);
        lastRequestedKeyRef.current = null;
        checkLoadMoreRef.current();
      }, NO_PROGRESS_RETRY_MS);
    },
    [roomJID, reduxStore]
  );

  const checkIfLoadMore = useCallback(
    (assumeNear = false) => {
      // While a jump window is on screen the live list is not what the reader
      // is looking at: no background prefetch of it, the window pages instead.
      if (windowActiveRef.current) {
        checkWindowLoadMoreRef.current();
        return;
      }
      if (isLoadingMoreRef.current) {return;}

      const state = reduxStore.getState().rooms;
      // A jump is already paging this room's history. A second request in
      // flight at the same time makes the server's answers interleave and one
      // of them time out, which the jump reads as the history being
      // unreachable.
      if (state.pendingJump?.roomJID === roomJID) {return;}
      // Read the room at call time: a closure over an old render would act on
      // an old cursor.
      const room = state.rooms[roomJID];
      if (!room || room.historyComplete) {return;}

      if (
        !assumeNear &&
        viewportHeightRef.current > 0 &&
        distanceToOlderEdge() >= prefetchDistance()
      ) {
        return;
      }

      const displayed = memoizedMessagesRef.current;
      const first = displayed.find(
        (message) => !String(message.id).startsWith('delimiter-new')
      );
      // Continue from the server's own cursor (the oldest ROW the last page
      // returned), never from the oldest DISPLAYED message alone: a page made
      // only of receipts or reactions displays nothing, the oldest message
      // does not change, and paging would stall with plenty of history left.
      const serverCursor = room.messageStats?.firstMessageTimestamp;
      const oldestDisplayed = first ? Number(first.id) : NaN;
      let before: number;
      if (Number.isFinite(oldestDisplayed)) {
        before =
          typeof serverCursor === 'number' && serverCursor < oldestDisplayed
            ? serverCursor
            : oldestDisplayed;
      } else if (typeof serverCursor === 'number' && Number.isFinite(serverCursor)) {
        before = serverCursor;
      } else {
        return;
      }

      // A repeat of the same request (same oldest message AND same cursor) is
      // what the guard stops; a page that only moved the cursor is progress.
      const key = `${first ? first.id : 'none'}|${before}`;
      if (key === lastRequestedKeyRef.current) {return;}

      // Hard stop for a long run of pages that add nothing to the list (an
      // archive that is almost all receipts): a reader scroll re-arms it.
      if (displayed.length !== idleLoadsLenRef.current) {
        idleLoadsLenRef.current = displayed.length;
        idleLoadsRef.current = 0;
      }
      if (idleLoadsRef.current >= MAX_IDLE_AUTO_PAGES) {return;}
      idleLoadsRef.current += 1;

      isLoadingMoreRef.current = true;
      lastRequestedKeyRef.current = key;
      setIsLoadingMore(true);

      let request: Promise<void>;
      try {
        request = Promise.resolve(
          loadMoreMessages(roomJID, HISTORY_PAGE_SIZE, before)
        );
      } catch (error) {
        request = Promise.reject(error);
      }
      request
        .catch(() => undefined)
        .then(() => {
          isLoadingMoreRef.current = false;
          growthGuardUntilRef.current = Date.now() + GROWTH_GUARD_MS;
          if (mountedRef.current) {setIsLoadingMore(false);}
          scheduleNoProgressRetry(key);
          // Keep the buffer above the reader topped up without waiting for the
          // next scroll event: a reader still inside the prefetch distance
          // once this page is in gets the next page right away, so a
          // normal-speed scroll never catches up with the loader. Deferred so
          // the new page has been rendered and measured first.
          setTimeout(() => {
            if (mountedRef.current) {checkLoadMoreRef.current();}
          }, 80);
        });
    },
    [loadMoreMessages, roomJID, reduxStore, scheduleNoProgressRetry]
  );
  checkLoadMoreRef.current = checkIfLoadMore;

  // A list that does not fill the viewport cannot scroll, so no scroll event
  // ever asks for older history (a first page made of receipts displays one
  // message and the archive behind it stays unreachable). Ask without one; the
  // chain in checkIfLoadMore then pages until the viewport fills. Threads load
  // through their own wrapper; a jump window pages itself.
  const scheduleAutoFill = useCallback(() => {
    if (isReply || windowActiveRef.current || !roomJID) {return;}
    if (autoFillTimerRef.current) {clearTimeout(autoFillTimerRef.current);}
    autoFillTimerRef.current = setTimeout(() => {
      autoFillTimerRef.current = null;
      if (!mountedRef.current) {return;}
      if (windowActiveRef.current || isLoadingMoreRef.current) {return;}
      const state = reduxStore.getState().rooms;
      if (state.pendingJump?.roomJID === roomJID) {return;}
      if (state.rooms[roomJID]?.historyComplete) {return;}
      // Not laid out yet: nothing to compare against.
      if (viewportHeightRef.current <= 0 || contentHeightRef.current <= 0) {return;}
      const unfilled =
        contentHeightRef.current <= viewportHeightRef.current ||
        distanceToOlderEdge() < prefetchDistance();
      if (!unfilled || !isUserAtBottomRef.current) {return;}
      checkLoadMoreRef.current();
    }, AUTO_FILL_DELAY_MS);
  }, [isReply, roomJID, reduxStore]);

  useEffect(() => {
    if (isReply || windowActive || loading || historyComplete) {return;}
    scheduleAutoFill();
  }, [
    roomJID,
    isReply,
    windowActive,
    loading,
    historyComplete,
    memoizedMessages.length,
    pagingCursor,
    scheduleAutoFill,
  ]);

  const handleLoadMore = useCallback(() => {
    // FlatList says the reader is near the older end.
    checkLoadMoreRef.current(true);
  }, []);

  // ---------------------------------------------------------------------
  // Jump window (a far jump shows a short slice of the archive around it)
  // ---------------------------------------------------------------------

  const [windowLoading, setWindowLoading] = useState<'older' | 'newer' | null>(
    null
  );
  const windowBusyRef = useRef<'older' | 'newer' | null>(null);
  const windowFailedAtRef = useRef({ older: 0, newer: 0 });
  const windowOpenedAtRef = useRef(0);
  const pendingExitScrollRef = useRef(false);
  const prevWindowActiveRef = useRef(windowActive);

  const exitWindow = useCallback(() => {
    if (!windowActiveRef.current) {return;}
    isUserAtBottomRef.current = true;
    hasUserScrolledRef.current = false;
    pendingExitScrollRef.current = true;
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
    setUnreadWhileScrolledUp(0);
    newestSeenTsRef.current = null;
    onReadBoundaryChange?.(null);
    dispatch(clearJumpWindow());
  }, [dispatch, onReadBoundaryChange]);

  // Back on the live list: land on its newest message.
  useEffect(() => {
    const was = prevWindowActiveRef.current;
    prevWindowActiveRef.current = windowActive;
    if (windowActive || !was) {return;}
    // A new jump is about to scroll somewhere else: leave the position to it.
    if (reduxStore.getState().rooms.pendingJump?.roomJID === roomJID) {return;}
    isUserAtBottomRef.current = true;
    pendingExitScrollRef.current = false;
    setIsUserAtBottom(true);
    const toLiveEnd = () =>
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    toLiveEnd();
    // The list swaps its data a frame later on a slow device: once more.
    const timer = setTimeout(toLiveEnd, 50);
    return () => clearTimeout(timer);
  }, [windowActive, roomJID, reduxStore]);

  // A window must not outlive the list that showed it.
  useEffect(
    () => () => {
      if (windowActiveRef.current) {dispatch(clearJumpWindow());}
    },
    [dispatch]
  );

  useEffect(() => {
    if (!jumpWindow?.targetId || !windowActive) {return;}
    windowOpenedAtRef.current = Date.now();
    windowFailedAtRef.current = { older: 0, newer: 0 };
    isUserAtBottomRef.current = false;
    setIsUserAtBottom(false);
    setShowNewMessageIndicator(false);
    // Reading a window of old history is not reading the latest messages: from
    // here on the read boundary is the newest live message the reader had
    // reached, never "everything".
    if (newestSeenTsRef.current === null) {
      const newest = (messages ?? []).reduce(
        (mx: number, m: IMessage) => Math.max(mx, msgSortableMs(m)),
        0
      );
      if (newest > 0) {
        newestSeenTsRef.current = newest;
        onReadBoundaryChange?.(newest);
      }
    }
    // A window that does not fill the viewport never scrolls, so nothing would
    // ask for the next page: look once it has settled.
    const timer = setTimeout(
      () => checkWindowLoadMoreRef.current(),
      WINDOW_SETTLE_MS + 100
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpWindow?.targetId, windowActive]);

  const loadWindowPage = useCallback(
    async (direction: 'older' | 'newer') => {
      const win = reduxStore.getState().rooms.jumpWindow;
      if (!win || win.roomJID !== roomJID || !client) {return;}
      if (windowBusyRef.current) {return;}
      windowBusyRef.current = direction;
      setWindowLoading(direction);
      try {
        const page =
          direction === 'older'
            ? await loadOlderWindowPage(client, win)
            : await loadNewerWindowPage(client, win);
        const current = reduxStore.getState().rooms.jumpWindow;
        // The reader left, or opened another window, while this was in flight.
        if (!current || current.targetId !== win.targetId) {return;}
        if (!page) {
          windowFailedAtRef.current[direction] = Date.now();
          return;
        }
        requestSendersOf(page.messages);
        if ('olderCursor' in page) {
          dispatch(prependJumpWindowMessages({ roomJID, ...page }));
        } else {
          dispatch(appendJumpWindowMessages({ roomJID, ...page }));
        }
      } catch {
        windowFailedAtRef.current[direction] = Date.now();
      } finally {
        windowBusyRef.current = null;
        if (mountedRef.current) {setWindowLoading(null);}
        setTimeout(() => {
          if (mountedRef.current) {checkWindowLoadMoreRef.current();}
        }, 80);
      }
    },
    [client, roomJID, dispatch, reduxStore]
  );

  checkWindowLoadMoreRef.current = (fromUserScroll = false) => {
    const win = reduxStore.getState().rooms.jumpWindow;
    if (!win || win.roomJID !== roomJID) {return;}
    const now = Date.now();
    if (now - windowOpenedAtRef.current < WINDOW_SETTLE_MS) {return;}
    // Not laid out yet: there is nothing to measure a distance against.
    if (viewportHeightRef.current <= 0 || contentHeightRef.current <= 0) {return;}
    const prefetch = prefetchDistance();
    const olderDistance = distanceToOlderEdge();
    const newerDistance = scrollOffsetRef.current;
    if (
      win.hasOlder &&
      olderDistance < prefetch &&
      now - windowFailedAtRef.current.older > WINDOW_RETRY_AFTER_FAILURE_MS
    ) {
      loadWindowPage('older');
    } else if (
      win.hasNewer &&
      newerDistance < prefetch &&
      now - windowFailedAtRef.current.newer > WINDOW_RETRY_AFTER_FAILURE_MS
    ) {
      loadWindowPage('newer');
    } else if (
      !win.hasNewer &&
      fromUserScroll &&
      newerDistance <= 5 &&
      now - windowOpenedAtRef.current > WINDOW_EXIT_GRACE_MS
    ) {
      // Nothing newer than this is left to load: that is the live tail.
      exitWindow();
    }
  };

  const handleStartReached = useCallback(() => {
    checkWindowLoadMoreRef.current();
  }, []);

  // A jump whose target is a thread reply opens the parent's thread (the main
  // list never shows replies); the thread list then highlights the reply.
  const resolveReply = useCallback(
    (jump: PendingJump, reply: IMessage, nearby?: IMessage[]) =>
      openThreadForJump({
        client,
        dispatch: dispatch as any,
        roomJID,
        at: jump.at,
        reply,
        live: messages ?? [],
        nearby,
      }),
    [client, dispatch, roomJID, messages]
  );

  const fetchWindow = useCallback(
    async (jump: PendingJump): Promise<WindowFetchResult> => {
      if (isReply || !client?.getHistoryWindow) {return 'unavailable';}
      const result = await loadJumpWindow(client, roomJID, jump.ids, {
        createdAt: jump.createdAt,
        body: jump.body,
      });
      if (result.status !== 'found') {return result.status;}
      const target = result.window.messages.find(
        (message) => String(message.id) === result.window.targetId
      );
      if (target && replyParentId(target)) {
        // Not a main-list message: the window is only used to learn what the
        // reply belongs to; it is not put on screen.
        const opened = await resolveReply(
          jump,
          target,
          result.window.messages
        ).catch(() => false);
        return opened ? 'found' : 'missing';
      }
      isUserAtBottomRef.current = false;
      requestSendersOf(result.window.messages);
      dispatch(setJumpWindow(result.window));
      return 'found';
    },
    [client, roomJID, isReply, dispatch, resolveReply]
  );

  const fetchOlderPage = useCallback(
    async (jid: string, before: number, max: number): Promise<OlderPage> => {
      if (!client) {return { ok: false };}
      const page = await client.getHistoryStanza(jid, max, before, undefined, {
        source: 'active',
      });
      // The page is in the store by now, and so is the server's cursor for it
      // (the <fin> handler writes it to messageStats).
      const room = reduxStore.getState().rooms.rooms[jid];
      return {
        ok: page !== undefined,
        cursor: room?.messageStats?.firstMessageTimestamp,
        complete: Boolean(room?.historyComplete),
      };
    },
    [client, reduxStore]
  );

  // The own message that was just sent is on the live list: leave the window
  // for it (the composer already clears it; this covers other send paths).
  const lastNewestIdRef = useRef<string | undefined>(
    messages[messages.length - 1]?.id
  );
  useEffect(() => {
    const newest = messages[messages.length - 1];
    const changed = newest && String(newest.id) !== lastNewestIdRef.current;
    lastNewestIdRef.current = newest ? String(newest.id) : undefined;
    if (
      changed &&
      windowActiveRef.current &&
      isOwnMessage(newest, user.xmppUsername || user.walletAddress)
    ) {
      exitWindow();
    }
  }, [messages, user.xmppUsername, user.walletAddress, exitWindow]);

  const dataMessages = useMemo(() => {
    const base = memoizedMessages.slice().reverse();
    const boundaryTs = newestSeenTsRef.current;
    if (
      windowActive ||
      isUserAtBottomRef.current ||
      boundaryTs === null ||
      unreadWhileScrolledUp === 0
    ) {
      return base;
    }

    let lastNewIndex = -1;
    for (let i = 0; i < base.length; i++) {
      if (msgSortableMs(base[i]) > boundaryTs) {
        lastNewIndex = i;
      } else {
        break;
      }
    }

    if (lastNewIndex === -1) {return base;}

    const withDivider = base.slice();
    withDivider.splice(lastNewIndex + 1, 0, {
      id: 'delimiter-new-local',
      user: {
        id: 'system',
        name: undefined,
        token: '',
        refreshToken: '',
      } as any,
      date: new Date(boundaryTs).toISOString(),
      body: 'New Messages',
      roomJid: roomJID,
    } as IMessage);
    return withDivider;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoizedMessages, isUserAtBottom, roomJID, unreadWhileScrolledUp, windowActive]);

  // Jump-to-message (search hit, notification): scroll to the row, then pulse
  // the bubble. The retry budget is for scrolling to a row the virtualised
  // list has not measured yet.
  const scrollRetryRef = useRef(0);
  const scrollToRow = useCallback((index: number) => {
    scrollRetryRef.current = 0;
    flatListRef.current?.scrollToIndex({
      index,
      viewPosition: 0.5,
      animated: false,
    });
  }, []);
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const offset = scrollRetryOffset(info, scrollRetryRef.current);
      if (offset === null) {return;}
      scrollRetryRef.current += 1;
      flatListRef.current?.scrollToOffset({ offset, animated: false });
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: info.index,
          viewPosition: 0.5,
          animated: false,
        });
      }, 120);
    },
    []
  );
  useJumpToMessage({
    roomJID,
    messages: memoizedMessages,
    listData: dataMessages,
    scrollToIndex: scrollToRow,
    onHighlight: setBubbleHighlight,
    loadMoreMessages,
    fetchOlderPage: client ? fetchOlderPage : undefined,
    historyComplete,
    isUserAtBottomRef,
    jumpWindowActive: windowActive,
    fetchWindow: isReply || !client ? undefined : fetchWindow,
    scope:
      isReply && activeMessage ? { threadId: String(activeMessage.id) } : 'main',
    allMessages: sourceMessages,
    resolveReply: isReply
      ? undefined
      : (jump, reply) => resolveReply(jump, reply),
    roomOpening:
      !isReply &&
      (Boolean(loading) ||
        joiningRoomJID === roomJID ||
        (sourceMessages.length === 0 && !historyComplete)),
  });

  const dateLabelIds = useMemo(() => {
    const ids = new Set<string>();
    let nextDay: string | null = null;
    for (let i = dataMessages.length - 1; i >= 0; i--) {
      const item = dataMessages[i];
      if (String(item.id).startsWith('delimiter-new')) {continue;}
      const day = dayKeyOf(item);
      if (nextDay === null || day !== nextDay) {ids.add(String(item.id));}
      nextDay = day;
    }
    return ids;
  }, [dataMessages]);

  const renderMessage = useCallback(
    ({ item }: { item: IMessage }) => {
      if (String(item.id).startsWith('delimiter-new')) {
        return (
          <MessageContainer
            CustomMessage={CustomMessage}
            CustomDaySeparator={CustomDaySeparator}
            CustomNewMessageLabel={CustomNewMessageLabel}
            message={item}
            activeMessage={activeMessage}
            config={config}
            walletAddress={user.xmppUsername || user.walletAddress}
            isReply={isReply}
            showDateLabel={false}
          />
        );
      }

      const showDateLabel = dateLabelIds.has(String(item.id));

      // The jump highlight is drawn by the message bubble itself (see
      // BubbleHighlight), so the row, its date label and its avatar stay put.
      return (
        <MessageContainer
          CustomMessage={CustomMessage}
          CustomDaySeparator={CustomDaySeparator}
          CustomNewMessageLabel={CustomNewMessageLabel}
          message={item}
          activeMessage={activeMessage}
          config={config}
          walletAddress={user.xmppUsername || user.walletAddress}
          isReply={isReply}
          showDateLabel={showDateLabel}
        />
      );
    },
    [
      activeMessage,
      config,
      CustomDaySeparator,
      CustomMessage,
      CustomNewMessageLabel,
      dateLabelIds,
      isReply,
      user.xmppUsername,
      user.walletAddress,
    ]
  );

  const scrollToBottom = useCallback(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({
        offset: 0,
        animated: true,
      });
    }
  }, [flatListRef]);

  const handleContentSizeChange = useCallback(
    (_width?: number, height?: number) => {
      if (typeof height === 'number' && height > 0) {
        contentHeightRef.current = height;
      }
      if (windowActiveRef.current) {
        // Reading a window of old history: never stick to the bottom.
        checkWindowLoadMoreRef.current();
        return;
      }
      const growing =
        isLoadingMoreRef.current || Date.now() < growthGuardUntilRef.current;
      if (!growing && flatListRef.current && isUserAtBottomRef.current) {
        scrollToBottom();
      } else if (!growing && hasUserScrolledRef.current) {
        setShowNewMessageIndicator(true);
      }
      scheduleAutoFill();
    },
    [scrollToBottom, scheduleAutoFill]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const offsetY = contentOffset.y;
      scrollOffsetRef.current = offsetY;
      if (contentSize?.height > 0) {contentHeightRef.current = contentSize.height;}
      if (layoutMeasurement?.height > 0) {
        viewportHeightRef.current = layoutMeasurement.height;
      }

      if (windowActiveRef.current) {
        // Reading a window of old history: never "at the bottom", always the
        // way back to the latest messages, and page both ways.
        isUserAtBottomRef.current = false;
        checkWindowLoadMoreRef.current(true);
        return;
      }

      // Don't force-dismiss the keyboard on every scroll event, any
      // touch on the message list used to close it, which made replying
      // to a long thread feel broken. Drag-to-dismiss still works via
      // FlatList's keyboardDismissMode="interactive" below.

      if (offsetY > 150 && !hasUserScrolledRef.current) {
        hasUserScrolledRef.current = true;
      }

      if (offsetY < 150) {
        isUserAtBottomRef.current = true;
        setShowNewMessageIndicator(false);
        setIsUserAtBottom(true);
        // Back at the bottom, clear the unread-while-scrolled-up
        // counter so the badge disappears with the arrow.
        setUnreadWhileScrolledUp(0);
        newestSeenTsRef.current = null;
        onReadBoundaryChange?.(null);
      } else {
        isUserAtBottomRef.current = false;
        if (hasUserScrolledRef.current) {
          setShowNewMessageIndicator(true);
        }
        if (newestSeenTsRef.current === null) {
          // Snapshot the NEWEST message's timestamp the moment the user
          // first leaves the bottom. Anything newer than this that
          // arrives later is genuinely "new"; older history loaded by
          // back-pagination is < this and never counts.
          newestSeenTsRef.current = memoizedMessages.reduce(
            (mx: number, m: IMessage) => {
              const ts = msgSortableMs(m);
              return ts > mx ? ts : mx;
            },
            0
          );
          onReadBoundaryChange?.(newestSeenTsRef.current);
        }
        setIsUserAtBottom(false);
      }
    },
    [memoizedMessages, onReadBoundaryChange]
  );

  // Keep the badge in sync with messages that arrive while the user is
  // scrolled up. Count ONLY messages newer than the newest-seen snapshot
  //, so loading older history (back-pagination) doesn't inflate it.
  useEffect(() => {
    if (windowActiveRef.current) {return;}
    if (isUserAtBottomRef.current) {return;}
    if (newestSeenTsRef.current === null) {return;}
    const since = newestSeenTsRef.current;
    const count = memoizedMessages.reduce(
      (n: number, m: IMessage) => (msgSortableMs(m) > since ? n + 1 : n),
      0
    );
    setUnreadWhileScrolledUp(count);
  }, [memoizedMessages, isUserAtBottom]);

  const handleLayout = (event?: LayoutChangeEvent) => {
    const height = event?.nativeEvent?.layout?.height;
    if (typeof height === 'number' && height > 0) {
      viewportHeightRef.current = height;
    }
    if (!windowActiveRef.current) {
      isUserAtBottomRef.current = true;
      hasUserScrolledRef.current = false;
      setIsUserAtBottom(true);
      scheduleAutoFill();
    }
  };

  const handleNewMessageIndicatorPress = () => {
    isUserAtBottomRef.current = true;
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
    setUnreadWhileScrolledUp(0);
    newestSeenTsRef.current = null;
    onReadBoundaryChange?.(null);
    scrollToBottom();
  };

  useEffect(() => {
    hasUserScrolledRef.current = false;
    isUserAtBottomRef.current = true;
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
    setUnreadWhileScrolledUp(0);
    newestSeenTsRef.current = null;
    onReadBoundaryChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomJID]);

  const BackgroundImage = useMemo(() => {
    const image = config?.backgroundChat?.image;

    if (image) {
      if (typeof image === 'function') {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return <SvgComponent width="100%" />;
      } else {
        return <Image source={image as ImageSourcePropType} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: getChatBackgroundColor(config) },
      ]}
    >
      <View style={styles.backgroundImageContainer}>{BackgroundImage}</View>
      {activeMessage && (
        <View>
          {CustomMessage && (
            <CustomMessage
              message={activeMessage}
              isUser={isOwnMessage(activeMessage, user)}
              isReply={isReply}
            />
          )}
          <TreadLabel reply={memoizedMessages.length} colors={config?.colors} />
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={dataMessages}
        renderItem={renderMessage}
        keyExtractor={keyExtractor}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={7}
        onEndReached={windowActive ? handleStartReached : handleLoadMore}
        onStartReached={windowActive ? handleStartReached : undefined}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        // Prefetch well ahead of the viewport (screens, not pixels) so a
        // normal scroll finds older history already there.
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        onStartReachedThreshold={END_REACHED_THRESHOLD}
        // In a jump window newer messages arrive at the near (offset 0) end:
        // keep what the reader is looking at where it is instead of letting
        // the content slide. The live list stays unanchored on purpose, it
        // follows its own newest end (handleContentSizeChange).
        maintainVisibleContentPosition={
          windowActive ? { minIndexForVisible: 0 } : undefined
        }
        scrollEventThrottle={16}
        onLayout={handleLayout}
        inverted={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={
          config?.keepKeyboardOpenOnScroll ? 'none' : 'interactive'
        }
        contentContainerStyle={styles.flatListContent}
        ListFooterComponent={
          (loading || isLoadingMore) &&
          !windowActive &&
          memoizedMessages.length > 15 ? (
            <Loader color={config?.colors?.primary} />
          ) : null
        }
      />
      {windowActive && windowLoading === 'older' && (
        <View
          testID="history-loader-older"
          pointerEvents="none"
          style={styles.loaderTop}
        >
          <Loader size={24} color={config?.colors?.primary} />
        </View>
      )}
      {windowActive && windowLoading === 'newer' && (
        <View
          testID="history-loader-newer"
          pointerEvents="none"
          style={styles.loaderBottom}
        >
          <Loader size={24} color={config?.colors?.primary} />
        </View>
      )}
      {windowActive ? (
        <TouchableOpacity
          testID="jump-to-latest"
          accessibilityRole="button"
          accessibilityLabel={t('action.jumpToLatest')}
          style={[
            styles.jumpToLatest,
            {
              backgroundColor: getIconColor(config),
              shadowColor: theme.shadow,
            },
          ]}
          onPress={exitWindow}
        >
          <ArowDownIcon color={theme.textOnPrimary} width={18} height={18} />
          <Text style={[styles.jumpToLatestText, { color: theme.textOnPrimary }]}>
            {t('action.jumpToLatest')}
          </Text>
        </TouchableOpacity>
      ) : (
        showNewMessageIndicator && (
          <TouchableOpacity
            style={[
              styles.newMessageIndicator,
              {
                backgroundColor: getIconColor(config),
                shadowColor: theme.shadow,
              },
            ]}
            onPress={handleNewMessageIndicatorPress}
          >
            {/* White chevron on the saturated FAB. The icon's default
              color is white, which was invisible against the previous
              light `secondary` background, hence "no icon". */}
            <ArowDownIcon color={theme.textOnPrimary} width={22} height={22} />
            {unreadWhileScrolledUp > 0 && (
              <View
                style={[
                  styles.newMessageBadge,
                  { backgroundColor: theme.danger, borderColor: theme.surface },
                ]}
              >
                <Text style={styles.newMessageBadgeText}>
                  {unreadWhileScrolledUp > 99 ? '99+' : unreadWhileScrolledUp}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )
      )}
      {config?.customTypingIndicator?.enabled && composing && (
        <CustomTypingIndicator
          usersTyping={composingList || ['User']}
          text={config.customTypingIndicator.text}
          position={config.customTypingIndicator.position || 'bottom'}
          styles={config.customTypingIndicator.styles}
          customComponent={config.customTypingIndicator.customComponent}
          isVisible={composing}
        />
      )}

      {!config?.customTypingIndicator?.enabled &&
        config?.disableHeader &&
        composing && <Composing usersTyping={composingList || ['User']} />}
    </View>
  );
};

export default MessageList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  flatListContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  messageList: {
    paddingHorizontal: 10,
    flexGrow: 1,
    backgroundColor: '#434343',
  },
  backgroundImageContainer: {
    width: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: -1,
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  // Float over the list so showing or hiding them never moves the messages.
  loaderTop: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  loaderBottom: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  jumpToLatest: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  jumpToLatestText: {
    fontSize: 13,
    fontWeight: '600',
  },
  newMessageIndicator: {
    position: 'absolute',
    width: 40,
    height: 40,
    bottom: 20,
    right: 20,
    backgroundColor: '#0052CD',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    // Lift the FAB off the chat background so it reads as a button.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  newMessageText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  newMessageBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    // Fixed red so it stays distinct from the (primary-coloured) FAB,
    // with a white ring to separate the two.
    backgroundColor: '#E53935',
    borderWidth: 2,
    borderColor: '#fff',
  },
  newMessageBadgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 11,
  },
});
