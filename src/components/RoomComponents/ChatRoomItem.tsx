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
import LastMessageItem from "./LastMessageItem";
import { LastRoomMessageText } from "./styled/StyledRoomComponents";

interface ChatRoomItemProps {
  chat: IRoom;
  index?: number;
  isDriver?: boolean;
  config?: IConfig;
}

const ChatRoomItem: React.FC<ChatRoomItemProps> = ({
  chat,
  index,
  isDriver,
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
    return `${hours}:${minutes}` || "";
  };

  console.log("ChatRoomItem render", 
    lastMessage?.body
  )

  return (
    <ChatItem key={index}>
      <ProfileImagePlaceholder name={chat.name} icon={chat?.icon} />
      <View
        style={{
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 2,
          width: "100%",
          paddingVertical: 8,
          paddingRight: 8,
          borderBottomWidth: 1,
          borderBottomColor: "#F0F0F0",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <ChatInfo>
            <ChatName text={chat.name || ""} />
          </ChatInfo>
          {lastMessage ? (
            <UserCount
              style={{
                color: "#8C8C8C",
                fontSize: 12,
              }}
              text={formatTimeToHHMM(lastMessage.date)}
            />
          ) : null}
        </View>
        <View
          style={{
            width: "100%",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            minHeight: 40,
          }}
        >
          {/* {chat.composing ? (
            <Composing
              usersTyping={chat.composingList}
              style={{ color: "#141414" }}
            />
            ) : lastMessage?.body ? (
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
          ) : null} */}
          {chat.composing ? (
            <Composing
              usersTyping={chat.composingList}
              // style={{ color: !isChatActive ? '#141414' : '#fff' }}
            />
          ) : lastMessage?.body ? (
            <LastMessageItem lastMessage={lastMessage} />
          ) : chat.messages.length === 0 && chat.historyComplete ? (
            <LastRoomMessageText>Room created</LastRoomMessageText>
          ) : undefined}
          {chat.unreadMessages && chat.unreadMessages > 0 ? (
            <View
              style={{
                borderRadius: 8,
                backgroundColor: config?.colors?.primary,
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
                  // color: isChatActive ? "#141414" : "#fff",
                  color: "#141414",
                  fontSize: 14,
                  fontWeight: "600",
                }}
              >
                {chat.unreadMessages || ""}
              </Text>
            </View>
          ) : null}
        </View>
        {isDriver && (
          <View
            style={{ height: 1, backgroundColor: "#0052CD0D", marginTop: 8 }}
          />
        )}
      </View>
    </ChatItem>
  );
};

export default ChatRoomItem;
