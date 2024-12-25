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
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Text,
} from "react-native";
import { IRoom } from "../../types/types";
import { SearchInput } from "../InputComponents/Search";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../roomStore";
import { BurgerMenuIcon, SearchIcon } from "../../assets/icons";
import DropdownMenu from "../DropdownMenu/DropdownMenu";
import { logout, setActiveModal } from "../../roomStore/chatSettingsSlice";
import NewChatModal from "../Modals/NewChatModal/NewChatModal";
import { setLogoutState } from "../../roomStore/roomsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
import { useXmppClient } from "../../context/xmppProvider";
import ChatRoomItem from "../RoomComponents/ChatRoomItem";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import Button from "../styled/Button";

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

  const dispatch = useDispatch();

  const { config } = useChatSettingState();
  const { activeRoomJID } = useSelector((state: RootState) => state.rooms);

  const containerRef = useRef<View>(null);

  const handleClickOutside = useCallback((event: any) => {
    if (containerRef.current && !containerRef.current.contains(event.target)) {
      setOpen(false);
    }
  }, []);

  const performClick = useCallback(
    (chat: IRoom) => {
      onRoomClick?.(chat);
      setOpen(false);
    },
    [onRoomClick]
  );

  const handleSearchChange = useCallback((text: string) => {
    setSearchTerm(text);
  }, []);

  const filteredChats = useMemo(() => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return chats.filter((chat) =>
      chat.name.toLowerCase().includes(lowerCaseSearchTerm)
    );
  }, [chats, searchTerm]);

  useEffect(() => {
    if (burgerMenu) {
      // Since React Native doesn't have a native mouse event, we won't use `mousedown`
      // A listener for "blur" event (on touch outside) or "TouchableWithoutFeedback" may be used for mobile
    }
  }, [burgerMenu]);

  const isChatActive = useCallback(
    (room: IRoom) => activeRoomJID === room.jid,
    [activeRoomJID]
  );

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
        label: "Profile",
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.PROFILE));
          console.log("Profile clicked");
        },
      },
      {
        label: "Settings",
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.SETTINGS));
          console.log("Settings clicked");
        },
      },
      {
        label: "Logout",
        onClick: handleLogout,
      },
    ],
    [handleLogout]
  );

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
          <ScrollView style={styles.scrollContainer}>
            <View style={styles.searchContainer}>
              {!config?.disableRoomMenu && (
                <DropdownMenu options={menuOptions} config={config} />
              )}
              <SearchInput
                icon={<SearchIcon height={20} />}
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Search..."
              />
              <NewChatModal />
            </View>
            <ScrollView style={styles.chatList}>
              {filteredChats.map((chat, index) => (
                <View key={chat.jid}>
                  <ChatRoomItem
                    chat={chat}
                    isChatActive={isChatActive(chat)}
                    performClick={performClick}
                    config={config}
                    isDriver={index < filteredChats.length - 1}
                  />
                </View>
              ))}
            </ScrollView>
          </ScrollView>
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
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    justifyContent: "space-between",
  },
  chatList: {
    flex: 1,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
});

export default RoomList;
