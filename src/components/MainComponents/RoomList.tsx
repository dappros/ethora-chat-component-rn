/** @format */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  Text,
  Image,
} from "react-native";
import { IRoom } from "../../types/types";
import { SearchInput } from "../InputComponents/Search";
import { useDispatch } from "react-redux";
import {
  AddNewIcon,
  BurgerMenuIcon,
  ProfileIcon,
  SearchIcon,
  SettingIcon,
} from "../../assets/icons";
import DropdownMenu from "../DropdownMenu/DropdownMenu";
import { logout, setActiveModal } from "../../roomStore/chatSettingsSlice";
import { setLogoutState } from "../../roomStore/roomsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
import { useXmppClient } from "../../context/xmppProvider";
import ChatRoomItem from "../RoomComponents/ChatRoomItem";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import Button from "../styled/Button";
import { ProfileImagePlaceholder } from "./ProfileImagePlaceholder";

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
  const { client, setClient } = useXmppClient();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [isLongPress, setIsLongPress] = useState(false);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);

  const dispatch = useDispatch();

  const { config, user, selectedUser } = useChatSettingState();

  const containerRef = useRef<View>(null);

  // const handleClickOutside = useCallback((event: any) => {
  //   if (containerRef.current && !containerRef.current.contains(event.target)) {
  //     setOpen(false);
  //   }
  // }, []);
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

  const filteredChats = useMemo(() => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const chatsMap = new Map<string, IRoom[]>();

    if (!chatsMap.has(lowerCaseSearchTerm)) {
      const result = chats
        .filter((chat) => chat.name.toLowerCase().includes(lowerCaseSearchTerm))
        .sort((a, b) => b.usersCnt - a.usersCnt);

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

  const handleLogout = useCallback(async () => {
    if (client) {
      await client.close();
      setClient(null);
    }
    dispatch(setLogoutState());
    dispatch(logout());
  }, [client, dispatch, setClient]);

  const menuOptions = useMemo(
    () => [
      {
        label: "New Chat",
        icon: <AddNewIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.NEW_CHAT));
          console.log("New chat clicked");
        },
        styles: { color: "#141414" },
      },
      {
        label: "Profile",
        icon: <ProfileIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.PROFILE));
          console.log("Profile clicked");
        },
      },
      {
        label: "Settings",
        icon: <SettingIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.SETTINGS));
          console.log("Settings clicked");
        },
      },
      // {
      //   label: "Logout",
      //   onClick: handleLogout,
      // },
    ],
    [handleLogout]
  );

  const HeaderLogo = useMemo(() => {
    const image = config?.headerLogo;

    if (image) {
      if (typeof image === "function") {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return <SvgComponent />;
        // return <image width="100%" height="100%" />
      } else {
        return <Image source={image} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  const openProfile = () => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    console.log("Profile clicked");
  };

  const modalUser: any = selectedUser ?? user;

  return (
    <>
      {burgerMenu && !open && (
        // <TouchableOpacity onPress={() => setOpen(!open)}>
        //   <Text style={styles.burgerButton}>☰</Text>
        // </TouchableOpacity>
        <Button
          style={{
            padding: 8,
            borderRadius: 16,
            backgroundColor: "transparent",
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
          <View style={styles.scrollContainer}>
            <View style={styles.searchContainer}>
              {!config?.disableRoomMenu && (
                <DropdownMenu
                  options={menuOptions}
                  config={config}
                  position="left"
                />
              )}
              <View>
                {config?.headerLogo ? (
                  HeaderLogo
                ) : (
                  <Text style={{ fontWeight: 500, fontSize: 18 }}>Chats</Text>
                )}
              </View>
              <ProfileImagePlaceholder
                icon={modalUser?.profileImage ?? null}
                name={modalUser?.name ?? modalUser?.firstName}
                size={30}
                click={{
                  isClick: true,
                  onPress: openProfile,
                }}
              />
              {/* <NewChatModal /> */}
            </View>
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

            {/* <FlatList
              data={chats}
              keyExtractor={(item) => item.jid}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => performClick(item)}
                  onPressIn={() => setIsScrolling(false)}
                >
                  <ChatRoomItem chat={item} config={config} />
                </Pressable>
              )}
              onScrollBeginDrag={() => setIsScrolling(true)}
              onScrollEndDrag={() => setIsScrolling(false)}
              onMomentumScrollEnd={() => setIsScrolling(false)}
              style={styles.chatList}
            /> */}
          </View>
        )}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  burgerButton: {
    fontSize: 24,
    padding: 10,
    color: "#333",
  },
  container: {
    width: "100%",
    height: "100%",
    flex: 1,
    backgroundColor: "#fff",
    marginTop: 10,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    justifyContent: "space-between",
  },
  chatList: {
    flex: 1,
    paddingTop: 10,
    paddingHorizontal: 8,
    backgroundColor: "#FAFAFA",
  },
});

export default RoomList;
