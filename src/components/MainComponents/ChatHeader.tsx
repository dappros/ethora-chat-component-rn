/** @format */

import React, { useCallback } from "react";
import {
  ChatContainerHeader,
  ChatContainerHeaderBoxInfo,
  ChatContainerHeaderInfo,
  ChatContainerHeaderLabel,
} from "../styled/StyledComponents";
import RoomList from "./RoomList";
import { IRoom } from "../../types/types";
import { ProfileImagePlaceholder } from "./ProfileImagePlaceholder";
import Button from "../styled/Button";
import { BackIcon } from "../../assets/icons";
import { useDispatch } from "react-redux";
import Composing from "../styled/StyledInputComponents/Composing";
import {
  deleteRoom,
  setCurrentRoom,
  setIsLoading,
} from "../../roomStore/roomsSlice";
import { useXmppClient } from "../../context/xmppProvider";
import { setActiveModal } from "../../roomStore/chatSettingsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
import { RoomMenu } from "../MenuRoom/MenuRoom";
import { useRoomState } from "../../hooks/useRoomState";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import { View, StyleSheet, Text } from "react-native";

interface ChatHeaderProps {
  currentRoom: IRoom;
  handleBackClick?: (value: boolean) => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentRoom,
  handleBackClick,
}) => {
  const dispatch = useDispatch();
  const { client } = useXmppClient();

  const { roomsList, activeRoomJID } = useRoomState(currentRoom.jid);
  const { composing } = useRoomState(currentRoom.jid).room;
  const { config } = useChatSettingState();

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({ roomJID: chat.jid }));
    dispatch(setIsLoading({ chatJID: chat.jid, loading: true }));
  };

  const handleLeaveClick = useCallback(() => {
    client.leaveTheRoomStanza(activeRoomJID);
    dispatch(deleteRoom({ jid: activeRoomJID }));

    const nextRoomJID = Object.keys(roomsList)[0] || null;
    if (nextRoomJID) {
      dispatch(setCurrentRoom({ roomJID: nextRoomJID }));
    }
  }, [activeRoomJID, roomsList, dispatch, client]);

  return (
    <ChatContainerHeader>
      {/* todo add here list of rooms */}
      <View style={styles.leftSection}>
        {handleBackClick && (
          <Button
            style={{ backgroundColor: "#1c1c1c" }}
            EndIcon={<BackIcon />}
            onPress={() => handleBackClick(false)}
          />
        )}
        {config?.chatHeaderBurgerMenu && roomsList && (
          <RoomList
            chats={Object.values(roomsList)}
            burgerMenu
            onRoomClick={handleChangeChat}
          />
        )}
        <ChatContainerHeaderBoxInfo
          onPress={() => dispatch(setActiveModal(MODAL_TYPES.CHAT_PROFILE))}
        >
          <View>
            <ProfileImagePlaceholder
              name={currentRoom.name}
              size={40}
              icon={currentRoom?.icon}
              active={true}
            />
          </View>
          <ChatContainerHeaderInfo>
            <ChatContainerHeaderLabel>
              {currentRoom?.title}
            </ChatContainerHeaderLabel>
            <View>
              {composing ? (
                <Composing usersTyping={currentRoom?.composingList} />
              ) : (
                <ChatContainerHeaderLabel style={styles.subLabel}>
                  <Text>{`${currentRoom?.usersCnt} users`}</Text>
                </ChatContainerHeaderLabel>
              )}
            </View>
          </ChatContainerHeaderInfo>
        </ChatContainerHeaderBoxInfo>
      </View>

      <View style={styles.rightSection}>
        {/* <SearchInput animated icon={<SearchIcon />} /> */}
        <RoomMenu handleLeaveClick={handleLeaveClick} />
      </View>
    </ChatContainerHeader>
  );
};

const styles = StyleSheet.create({
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  subLabel: {
    color: "#8C8C8C",
    fontSize: 14,
  },
});

export default ChatHeader;
