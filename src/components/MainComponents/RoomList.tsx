/** @format */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
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

const LONG_PRESS_THRESHOLD = 200;

interface RoomListProps {
  chats: IRoom[];
  burgerMenu?: boolean;
  onRoomClick?: (chat: IRoom) => void;
}

/** Page ground behind the room list, the search field and the header's
 * rounded bottom corners. */
const LIST_BACKGROUND = '#E8EDF2';

/** A release that leaves the search strip in between is settled by
 * scrolling to whichever end is nearer; this delay lets the platform tell
 * us first whether the finger threw the list (momentum) or just let go. */
const SNAP_SETTLE_DELAY = 60;

const RoomList: React.FC<RoomListProps> = ({
  chats,
  burgerMenu = false,
  onRoomClick,
}) => {
  const { config } = useChatSettingState();
  const t = useT();

  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLongPress, setIsLongPress] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isSearchFocused, setSearchFocused] = useState(false);

  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<View>(null);
  const listRef = useRef<FlatList<IRoom>>(null);

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

  const getLastMessage = useCallback(
    (chat: IRoom) => chat?.messages?.[chat?.messages.length - 1],
    []
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
        .sort((a, b) => {
          if (getLastMessage(a)?.id && getLastMessage(b)?.id) {
            return Number(getLastMessage(b).id) - Number(getLastMessage(a).id);
          } else if (getLastMessage(a)?.id) {
            return -1;
          } else if (getLastMessage(b)?.id) {
            return 1;
          }
          return -1;
        });

      chatsMap.set(lowerCaseSearchTerm, result);
    }

    return chatsMap.get(lowerCaseSearchTerm) || [];
  }, [chats, searchTerm]);

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

  const hideSearchInitially = useCallback(() => {
    if (didInitialHide.current || hasDragged.current) return;
    const bar = searchBarHeight.current;
    if (!bar || !listHeight.current || !contentHeight.current) return;
    if (maxOffset() < bar) return;
    didInitialHide.current = true;
    listRef.current?.scrollToOffset({ offset: bar, animated: false });
  }, []);

  /** The magnet: a strip left half-way in or out settles to whichever
   * end it is closer to. */
  const snapSearch = useCallback((offset: number) => {
    const bar = searchBarHeight.current;
    if (!bar || maxOffset() < bar) return;
    if (offset <= 0 || offset >= bar) return;
    const hide = !searchIsActive.current && offset > bar / 2;
    listRef.current?.scrollToOffset({ offset: hide ? bar : 0, animated: true });
  }, []);

  const clearSettleTimer = () => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  };

  useEffect(() => clearSettleTimer, []);

  const handleScrollBeginDrag = useCallback(() => {
    hasDragged.current = true;
    clearSettleTimer();
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

  const searchHeader = (
    <View
      testID="room-list-search"
      style={styles.searchBar}
      onLayout={(e) => {
        searchBarHeight.current = e.nativeEvent.layout.height;
        hideSearchInitially();
      }}
    >
      <SearchInput
        icon={<SearchIcon height={20} />}
        value={searchTerm}
        onChangeText={handleSearchChange}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        placeholder={t('search.placeholder')}
      />
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
        style={[styles.container, config?.roomListStyles]}
      >
        {(open || !burgerMenu) && (
          <>
            <View style={styles.scrollContainer}>
              <HeaderRoomList setDrawerOpen={toggleDrawer} />
              <View style={styles.listArea}>
                <FlatList
                  ref={listRef}
                  data={filteredChats}
                  keyExtractor={(item) => item.jid}
                  ListHeaderComponent={searchHeader}
                  onLayout={(e) => {
                    listHeight.current = e.nativeEvent.layout.height;
                    hideSearchInitially();
                  }}
                  onContentSizeChange={(_w, h) => {
                    contentHeight.current = h;
                    hideSearchInitially();
                  }}
                  onScrollBeginDrag={handleScrollBeginDrag}
                  onScrollEndDrag={handleScrollEndDrag}
                  onMomentumScrollBegin={handleMomentumBegin}
                  onMomentumScrollEnd={handleMomentumEnd}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <Pressable
                      // Stable testID so e2e drivers can target a room
                      // row by its jid local-part (e.g. Main chat under
                      // app id `..._...759` → testID `room-...759`).
                      testID={`room-${(item.jid || '').split('@')[0]}`}
                      accessibilityLabel={`room-${item.title || item.name}`}
                      onPress={() => performClick(item)}
                      onPressIn={handlePressIn}
                      onPressOut={handlePressOut}
                    >
                      <ChatRoomItem chat={item} config={config} />
                    </Pressable>
                  )}
                  style={styles.chatList}
                />
              </View>

              <HeaderRoomListMenu
                closeDrawer={closeDrawer}
                drawerAnimation={drawerAnimation}
                overlayAnimation={overlayAnimation}
                isDrawerOpen={isDrawerOpen}
              />
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
    backgroundColor: LIST_BACKGROUND,
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
    // `row` matters: SearchInputWrapper is `flex: 1` plus a fixed 44px
    // height. In a column parent that flex resolves VERTICALLY against a
    // parent with no height of its own and collapses the field to nothing
    // but its magnifier. As a row it resolves to width.
    flexDirection: 'row',
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  chatList: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: LIST_BACKGROUND,
  },
});

export default RoomList;
