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

const LONG_PRESS_THRESHOLD = 200;

interface RoomListProps {
  chats: IRoom[];
  burgerMenu?: boolean;
  onRoomClick?: (chat: IRoom) => void;
}

const RoomList: React.FC<RoomListProps> = ({
  chats,
  burgerMenu = false,
  onRoomClick,
}) => {
  const { config } = useChatSettingState();

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
          EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
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
              <FlatList
                data={filteredChats}
                keyExtractor={(item) => item.jid}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => performClick(item)}
                    onPressIn={handlePressIn}
                    onPressOut={handlePressOut}
                  >
                    <ChatRoomItem chat={item} config={config} />
                  </Pressable>
                )}
                ListHeaderComponent={
                  <SearchInput
                    icon={<SearchIcon height={20} />}
                    value={searchTerm}
                    onChangeText={handleSearchChange}
                    placeholder="Search..."
                  />
                }
                style={styles.chatList}
              />

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
    backgroundColor: '#fff',
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
  chatList: {
    flex: 1,
    paddingTop: 10,
    paddingHorizontal: 8,
    backgroundColor: '#FAFAFA',
  },
});

export default RoomList;
