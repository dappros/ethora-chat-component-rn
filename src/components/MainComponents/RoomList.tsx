/** @format */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { deleteRoom } from '../../roomStore/roomsSlice';
import { useXmppClient } from '../../context/xmppProvider';
import SwipeableRoomRow, { closeOpenRoomRow } from '../RoomComponents/SwipeableRoomRow';
import ReportChatModal from '../Modals/ChatProfileModal/ReportChatModal';
import { IRoom } from '../../types/types';
import { SearchInput } from '../InputComponents/Search';
import { BurgerMenuIcon, SearchIcon } from '../../assets/icons';
import ChatRoomItem from '../RoomComponents/ChatRoomItem';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import Button from '../styled/Button';
import { HeaderRoomList } from '../Header/HeaderRoomList';
import { HeaderRoomListMenu } from '../Menu/HeaderRoomListMenu';
import { getIconColor } from '../../helpers/getIconColor';
import { useT } from '../../i18n/useT';
import { useTheme } from '../../hooks/useTheme';
import { useRoomMute } from '../../hooks/useRoomMute';
import { isMessageSearchEnabled } from '../../helpers/isMessageSearchEnabled';
import { useMessageSearch } from '../Modals/MessageSearchModal/useMessageSearch';
import type { MessageSearchHit } from '../../networking/api-requests/messageSearch.api';
import {
  MessageHitList,
  SecondaryPillButton,
  useMessageHitActions,
} from '../Modals/MessageSearchModal/MessageHitResults';

const LONG_PRESS_THRESHOLD = 200;

interface RoomListProps {
  chats: IRoom[];
  burgerMenu?: boolean;
  onRoomClick?: (chat: IRoom) => void;
}

// The page ground behind the room list, the search field and the header's
// rounded bottom corners is `theme.listBackground` (applied inline below).

/** A release that leaves the search strip in between is settled by
 * scrolling to whichever end is nearer; this delay lets the platform tell
 * us first whether the finger threw the list (momentum) or just let go. */
const SNAP_SETTLE_DELAY = 60;

const COLLAPSED_SCALE = 0.86;

const SEARCH_REST_GAP = 16;

export const searchRevealStyle = (
  scrollY: Animated.Value,
  hiddenOffset: number
) => {
  const travel = Math.max(hiddenOffset, 1);
  return {
    opacity: scrollY.interpolate({
      inputRange: [0, travel * 0.85],
      outputRange: [1, 0],
      extrapolate: 'clamp' as const,
    }),
    transform: [
      {
        scale: scrollY.interpolate({
          inputRange: [0, travel],
          outputRange: [1, COLLAPSED_SCALE],
          extrapolate: 'clamp' as const,
        }),
      },
    ],
  };
};

const RoomList: React.FC<RoomListProps> = ({
  chats,
  burgerMenu = false,
  onRoomClick,
}) => {
  const { config } = useChatSettingState();
  const t = useT();
  const theme = useTheme();
  const dispatch = useDispatch();
  const { client } = useXmppClient();

  const [open, setOpen] = useState(false);
  // The room a swiped row's Report opened the form for.
  const [reportJid, setReportJid] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLongPress, setIsLongPress] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isSearchFocused, setSearchFocused] = useState(false);

  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<View>(null);
  const listRef = useRef<FlatList<IRoom> | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  const drawerAnimation = useRef(new Animated.Value(0)).current;
  const overlayAnimation = useRef(new Animated.Value(0)).current;

  const handlePressIn = useCallback(() => {
    setIsLongPress(false);
    pressTimer.current = setTimeout(() => {
      setIsLongPress(true);
    }, LONG_PRESS_THRESHOLD);
  }, []);

  const handlePressOut = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
    }
  }, []);

  const performClick = useCallback(
    (chat: IRoom) => {
      if (!isLongPress) {
        onRoomClick?.(chat);
      }
      setOpen(false);
    },
    [onRoomClick, isLongPress]
  );

  const handleSearchChange = useCallback((text: string) => {
    setSearchTerm(text);
  }, []);

  // Behind a row swiped left. Leaving is the chat profile's flow: an
  // unavailable presence to the MUC, then the room dropped from the store.
  const swipeActions = !config?.disableRoomSwipeActions;
  const handleLeaveRoom = useCallback(
    (jid: string) => {
      Alert.alert(t('modal.leaveChat.title'), t('modal.leaveChat.description'), [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('action.leave'),
          style: 'destructive',
          onPress: () => {
            try {
              client?.leaveTheRoomStanza?.(jid);
            } catch (error) {
              console.error('Failed to leave the room:', error);
            }
            dispatch(deleteRoom({ jid }));
          },
        },
      ]);
    },
    [client, dispatch, t]
  );
  const handleReportRoom = useCallback((jid: string) => setReportJid(jid), []);
  const toggleRoomMuted = useRoomMute();
  const handleToggleMute = useCallback(
    async (jid: string) => {
      if (!(await toggleRoomMuted(jid))) {
        Alert.alert(t('toast.error'), t('toast.muteFailed'));
      }
    },
    [toggleRoomMuted, t]
  );

  const activityOf = useCallback((chat: IRoom): number => {
    const last = chat?.messages?.[chat?.messages.length - 1];
    const fromLive = Number(last?.id);
    if (Number.isFinite(fromLive) && fromLive > 0) {return fromLive;}
    const fromStamp = Number(chat?.lastMessageTimestamp);
    if (Number.isFinite(fromStamp) && fromStamp > 0) {return fromStamp;}
    const fromSeed = Number(chat?.lastMessage?.id);
    if (Number.isFinite(fromSeed) && fromSeed > 0) {return fromSeed;}
    return 0;
  }, []);

  // The same box that filters chats by title also looks inside the messages.
  // Off wherever message search is off (no request, no block).
  const messageSearchEnabled = isMessageSearchEnabled(config);
  const messageSearch = useMessageSearch(
    messageSearchEnabled ? searchTerm : '',
    'all'
  );
  const { open: openHit, activeRoomJID } = useMessageHitActions();
  const openMessageHit = useCallback(
    (hit: MessageSearchHit) => {
      const target = (chats || []).find(
        (chat) =>
          chat?.jid === hit.room || chat?.jid?.split('@')[0] === hit.chatId
      );
      // The path a tap on a chat row takes, so a host that routes on room
      // clicks sees this one too; then land on the message.
      if (target && target.jid !== activeRoomJID) performClick(target);
      openHit(hit);
    },
    [chats, activeRoomJID, performClick, openHit]
  );

  const filteredChats = useMemo(() => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const chatsMap = new Map<string, IRoom[]>();

    if (!chatsMap.has(lowerCaseSearchTerm)) {
      const result = chats
        .filter((chat) => {
          const hay = `${chat?.title || ''} ${chat?.name || ''}`.toLowerCase();
          return hay.includes(lowerCaseSearchTerm);
        })
        .sort((a, b) => activityOf(b) - activityOf(a));

      chatsMap.set(lowerCaseSearchTerm, result);
    }

    return chatsMap.get(lowerCaseSearchTerm) || [];
  }, [chats, searchTerm, activityOf]);

  useEffect(() => {
    if (burgerMenu) {
      // Since React Native doesn't have a native mouse event, we won't use `mousedown`
      // A listener for "blur" event (on touch outside) or "TouchableWithoutFeedback" may be used for mobile
    }
  }, [burgerMenu]);

  // The search field is the list's own header rather than a bar pinned
  // above it: it lives in the scrollable content, so the list opens
  // already scrolled past it (rooms first, no search in sight) and
  // dragging the content down brings it back with the finger — the way
  // Telegram's chat list behaves. A pinned bar could not do this on
  // Android, where a list sitting at offset 0 has nothing left to drag.
  const searchBarHeight = useRef(0);
  const [measuredBarHeight, setMeasuredBarHeight] = useState(0);
  const listHeight = useRef(0);
  const contentHeight = useRef(0);
  /** The list starts hidden-search only once, and only before the user
   * has touched it — chats arriving later must not yank the view. */
  const didInitialHide = useRef(false);
  const hasDragged = useRef(false);
  const inMomentum = useRef(false);
  const settleTimer = useRef<NodeJS.Timeout | null>(null);

  // A search being typed in (or just focused) is never tucked away
  // under the header, whichever way the list is then dragged.
  const searchIsActive = useRef(false);
  searchIsActive.current = isSearchFocused || searchTerm.length > 0;

  /** How far the list can scroll — the strip can only be hidden fully
   * when the rooms below it are tall enough to take its place. */
  const maxOffset = () => contentHeight.current - listHeight.current;

  const hiddenOffset = () =>
    Math.max(searchBarHeight.current - SEARCH_REST_GAP, 0);

  const hideSearchInitially = useCallback(() => {
    if (didInitialHide.current || hasDragged.current) return;
    const hidden = hiddenOffset();
    if (!hidden || !listHeight.current || !contentHeight.current) return;
    if (maxOffset() < hidden) return;
    didInitialHide.current = true;
    listRef.current?.scrollToOffset({ offset: hidden, animated: false });
  }, []);

  /** The magnet: a strip left half-way in or out settles to whichever
   * end it is closer to. */
  const snapSearch = useCallback((offset: number) => {
    const hidden = hiddenOffset();
    if (!hidden || maxOffset() < hidden) return;
    if (offset <= 0 || offset >= hidden) return;
    const hide = !searchIsActive.current && offset > hidden / 2;
    listRef.current?.scrollToOffset({
      offset: hide ? hidden : 0,
      animated: true,
    });
  }, []);

  const clearSettleTimer = () => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  };

  useEffect(() => clearSettleTimer, []);

  const handleScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      }),
    [scrollY]
  );

  const revealStyle = useMemo(
    () =>
      searchRevealStyle(
        scrollY,
        Math.max(measuredBarHeight - SEARCH_REST_GAP, 0)
      ),
    [scrollY, measuredBarHeight]
  );

  const handleScrollBeginDrag = useCallback(() => {
    hasDragged.current = true;
    clearSettleTimer();
    // Scrolling folds a row's actions back, as in the messengers.
    closeOpenRoomRow();
  }, []);

  const handleScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.y;
      inMomentum.current = false;
      clearSettleTimer();
      // A flick keeps scrolling after the release; snapping now would
      // fight it, so wait a beat and let momentum claim the gesture.
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        if (!inMomentum.current) snapSearch(offset);
      }, SNAP_SETTLE_DELAY);
    },
    [snapSearch]
  );

  const handleMomentumBegin = useCallback(() => {
    inMomentum.current = true;
    clearSettleTimer();
  }, []);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      inMomentum.current = false;
      snapSearch(e.nativeEvent.contentOffset.y);
    },
    [snapSearch]
  );

  // Tapping the field pulls it fully into view even if it was caught
  // half-way, so the caret never sits under the header.
  useEffect(() => {
    if (isSearchFocused) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [isSearchFocused]);

  const renderRoom = useCallback(
    ({ item }: { item: IRoom }) => {
      const row = (
        <Pressable
          testID={`room-${(item.jid || '').split('@')[0]}`}
          accessibilityLabel={`room-${item.title || item.name}`}
          onPress={() => performClick(item)}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <ChatRoomItem chat={item} config={config} />
        </Pressable>
      );
      if (!swipeActions || !item.jid) {return row;}
      return (
        <SwipeableRoomRow
          roomJid={item.jid}
          muted={!!item.muted}
          onToggleMute={handleToggleMute}
          onReport={handleReportRoom}
          onLeave={handleLeaveRoom}
        >
          {row}
        </SwipeableRoomRow>
      );
    },
    [
      performClick,
      handlePressIn,
      handlePressOut,
      config,
      swipeActions,
      handleReportRoom,
      handleLeaveRoom,
      handleToggleMute,
    ]
  );

  const toggleDrawer = () => {
    if (isDrawerOpen) {
      closeDrawer();
    } else {
      setDrawerOpen(true);
      Animated.parallel([
        Animated.timing(drawerAnimation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnimation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  const closeDrawer = () => {
    Animated.parallel([
      Animated.timing(drawerAnimation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnimation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDrawerOpen(false);
    });
  };

  const messageMatches =
    messageSearchEnabled && messageSearch.searchable ? (
      <View testID="room-list-message-matches" style={styles.matches}>
        {messageSearch.items.length > 0 && (
          <>
            <View style={styles.matchesTitle}>
              <Text style={[styles.matchesTitleText, { color: theme.text }]}>
                {t('search.messages.title')}
              </Text>
              <Text style={[styles.matchesCount, { color: theme.textMuted }]}>
                {t('search.messages.count', { count: messageSearch.total })}
              </Text>
            </View>
            <MessageHitList
              hits={messageSearch.items}
              query={searchTerm.trim()}
              showRoom
              onOpen={openMessageHit}
            />
            {messageSearch.hasMore && (
              <SecondaryPillButton
                testID="room-list-message-more"
                onPress={messageSearch.loadMore}
                disabled={messageSearch.status === 'loadingMore'}
                label={
                  messageSearch.status === 'loadingMore'
                    ? t('search.messages.searching')
                    : t('search.messages.loadMore')
                }
              />
            )}
          </>
        )}
        {messageSearch.status === 'loading' && (
          <Text
            testID="room-list-message-searching"
            style={[styles.matchesNote, { color: theme.textMuted }]}
          >
            {t('search.messages.searching')}
          </Text>
        )}
        {messageSearch.status === 'done' &&
          messageSearch.items.length === 0 &&
          filteredChats.length === 0 && (
            <Text
              testID="room-list-message-empty"
              style={[styles.matchesNote, { color: theme.textMuted }]}
            >
              {t('search.messages.empty')}
            </Text>
          )}
        {messageSearch.status === 'error' && (
          <View style={styles.matchesNote}>
            <Text
              testID="room-list-message-error"
              style={[styles.matchesError, { color: theme.danger }]}
            >
              {t('search.messages.error')}
            </Text>
            <SecondaryPillButton
              testID="room-list-message-retry"
              onPress={messageSearch.retry}
              label={t('search.messages.retry')}
            />
          </View>
        )}
      </View>
    ) : null;

  const searchHeader = (
    <View
      testID="room-list-search"
      style={styles.searchBar}
      onLayout={(e) => {
        const height = e.nativeEvent.layout.height;
        searchBarHeight.current = height;
        setMeasuredBarHeight((prev) => (prev === height ? prev : height));
        hideSearchInitially();
      }}
    >
      <Animated.View
        testID="room-list-search-field"
        style={[styles.searchField, revealStyle]}
      >
        <SearchInput
          icon={<SearchIcon height={20} />}
          value={searchTerm}
          onChangeText={handleSearchChange}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={t('search.placeholder')}
        />
      </Animated.View>
    </View>
  );

  return (
    <>
      {burgerMenu && !open && (
        <Button
          style={{
            padding: 8,
            borderRadius: 16,
            backgroundColor: 'transparent',
          }}
          color="black"
          unstyled
          EndIcon={<BurgerMenuIcon color={getIconColor(config)} />}
          onPress={() => setOpen(!open)}
        />
      )}
      <View
        ref={containerRef}
        style={[
          styles.container,
          { backgroundColor: theme.listBackground },
          config?.roomListStyles,
        ]}
      >
        {(open || !burgerMenu) && (
          <>
            <View style={styles.scrollContainer}>
              <HeaderRoomList setDrawerOpen={toggleDrawer} />
              <View style={styles.listArea}>
                {/* Animated.FlatList, so the reveal runs on the native
                    thread off the very same scroll it follows. */}
                <Animated.FlatList
                  ref={listRef}
                  data={filteredChats}
                  keyExtractor={(item) => item.jid}
                  ListHeaderComponent={searchHeader}
                  ListFooterComponent={messageMatches}
                  onLayout={(e) => {
                    listHeight.current = e.nativeEvent.layout.height;
                    hideSearchInitially();
                  }}
                  onContentSizeChange={(_w, h) => {
                    contentHeight.current = h;
                    hideSearchInitially();
                  }}
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                  onScrollBeginDrag={handleScrollBeginDrag}
                  onScrollEndDrag={handleScrollEndDrag}
                  onMomentumScrollBegin={handleMomentumBegin}
                  onMomentumScrollEnd={handleMomentumEnd}
                  keyboardShouldPersistTaps="handled"
                  renderItem={renderRoom}
                  style={[
                    styles.chatList,
                    { backgroundColor: theme.listBackground },
                  ]}
                />
              </View>

              <HeaderRoomListMenu
                closeDrawer={closeDrawer}
                drawerAnimation={drawerAnimation}
                overlayAnimation={overlayAnimation}
                isDrawerOpen={isDrawerOpen}
              />
              {/* Mounted only while a report is being written: the form
                  is a Modal of its own and wants the toast context. */}
              {reportJid !== null && (
                <ReportChatModal
                  visible
                  roomJid={reportJid}
                  onClose={() => setReportJid(null)}
                />
              )}
            </View>
          </>
        )}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  burgerButton: {
    fontSize: 24,
    padding: 10,
    color: '#333',
  },
  container: {
    width: '100%',
    height: '100%',
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    justifyContent: 'space-between',
  },
  listArea: {
    flex: 1,
  },
  searchBar: {
    paddingBottom: 4,
    // `row` matters: SearchInputWrapper is `flex: 1` plus a fixed 44px
    // height. In a column parent that flex resolves VERTICALLY against a
    // parent with no height of its own and collapses the field to nothing
    // but its magnifier. As a row it resolves to width.
    flexDirection: 'row',
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  searchField: {
    flexDirection: 'row',
    flex: 1,
  },
  matches: { paddingBottom: 12 },
  matchesTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 8,
  },
  matchesTitleText: { fontSize: 14, fontWeight: '600' },
  matchesCount: { fontSize: 12 },
  matchesError: { textAlign: 'center' },
  matchesNote: { paddingVertical: 8, alignItems: 'center' },
  chatList: {
    flex: 1,
    paddingHorizontal: 16,
  },
});

export default RoomList;
