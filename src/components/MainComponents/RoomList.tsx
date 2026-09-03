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
  Text,
  TouchableOpacity,
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

/** First-paint fallback until the floating search strip reports its real
 * height; the list's top padding follows the measurement after that. */
const SEARCH_BAR_ESTIMATE = 60;

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

  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<View>(null);

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

  // Measured, so the list's top padding always matches the floating
  // search strip — including when a larger font or a taller field grows it.
  const [searchBarHeight, setSearchBarHeight] = useState(SEARCH_BAR_ESTIMATE);

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
              {/* The search field floats OVER the list rather than
                  sitting above it in the column: its strip is transparent
                  and the rooms scroll underneath, which is what the design
                  shows. It is still fixed (not a ListHeaderComponent), so
                  it stays reachable however far the list is scrolled — as a
                  list header it scrolled away behind the opaque header. */}
              <View style={styles.listArea}>
                <FlatList
                  data={filteredChats}
                  keyExtractor={(item) => item.jid}
                  // Clears the floating field on first paint; scrolling
                  // then slides the rooms under it.
                  contentContainerStyle={{ paddingTop: searchBarHeight }}
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
                <View
                  testID="room-list-search"
                  style={styles.searchBar}
                  onLayout={(e) =>
                    setSearchBarHeight(e.nativeEvent.layout.height)
                  }
                >
                  <SearchInput
                    icon={<SearchIcon height={20} />}
                    value={searchTerm}
                    onChangeText={handleSearchChange}
                    placeholder={t('search.placeholder')}
                  />
                </View>
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
    // but its magnifier. As a row it resolves to width, which is what it
    // meant back when the field was a list-header child.
    flexDirection: 'row',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  chatList: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: LIST_BACKGROUND,
  },
});

export default RoomList;
