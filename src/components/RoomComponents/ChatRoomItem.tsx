import React, { useMemo } from "react";
import { IConfig, IRoom } from "../../types/types";
import { ProfileImagePlaceholder } from "../MainComponents/ProfileImagePlaceholder";
import {
  ChatItem,
  ChatInfo,
  ChatName,
  LastMessage,
  UserCount,
} from "../styled/RoomListComponents";
import Composing from "../styled/StyledInputComponents/Composing";
import { Text, View } from "react-native";

interface ChatRoomItemProps {
  chat: IRoom;
  index: number;
  isChatActive: boolean;
  performClick: (chat: IRoom) => void;
  config: IConfig;
}

const ChatRoomItem: React.FC<ChatRoomItemProps> = ({
  chat,
  index,
  isChatActive,
  performClick,
  config,
}) => {
  const lastMessage = useMemo(
    () => chat?.messages?.[chat?.messages.length - 1],
    [chat?.messages?.length]
  );

  const formatTimeToHHMM = (isoTime: string | Date): string => {
    const date = new Date(isoTime);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  return (
    <ChatItem
      key={index}
      active={isChatActive}
      onPress={() => performClick(chat)}
      bg={config?.colors?.primary}
    >
      <ProfileImagePlaceholder name={chat.name} icon={chat?.icon} />
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
        }}
      >
        <View
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            gap: 16,
            height: 24,
            justifyContent: "space-between",
          }}
        >
          <ChatInfo>
            <ChatName>{chat.name}</ChatName>
          </ChatInfo>
          {lastMessage && (
            <UserCount
              style={{
                color: !isChatActive ? "#8C8C8C" : "#fff",
                fontSize: 12,
              }}
              active={isChatActive}
            >
              {formatTimeToHHMM(lastMessage.date)}
            </UserCount>
          )}
        </View>
        <View
          style={{
            // textAlign: "right",
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {chat.composing ? (
            <Composing
              usersTyping={chat.composingList}
              style={{ color: !isChatActive ? "#141414" : "#fff" }}
            />
          ) : (
            lastMessage?.body && (
              <View
                style={{
                  display: "flex",
                  width: "80%",
                  flexDirection: "column",
                  alignItems: "flex-start",
                }}
              >
                <View
                  style={{
                    height: 20,
                  }}
                >
                  <Text style={{ fontWeight: "600", textAlign: "right" }}>
                    {lastMessage.user.name || ""}:
                  </Text>
                </View>
                <View
                  style={{
                    height: 20,
                    maxWidth: 200,
                    overflow: "hidden",
                  }}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                      textAlign: "right",
                    }}
                  >
                    {lastMessage.body || "Chat created"}
                  </Text>
                </View>
              </View>
            )
          )}
          {chat.unreadMessages && chat.unreadMessages > 0 && (
            <View
              style={{
                borderRadius: 8,
                backgroundColor: isChatActive
                  ? "#fff"
                  : config?.colors?.primary,
                padding: 2,
                minWidth: 24,
                minHeight: 24,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                marginLeft: "auto",
              }}
            >
              <Text
                style={{
                  color: isChatActive ? "#141414" : "#fff",
                  fontSize: 14,
                  fontWeight: "600",
                }}
              >
                {chat.unreadMessages}
              </Text>
            </View>
          )}
        </View>
      </View>
    </ChatItem>
  );
};

export default ChatRoomItem;
