import React, { useRef, useState } from "react";
import {
  View,
  TouchableWithoutFeedback,
  StyleSheet,
  findNodeHandle,
  UIManager,
  Dimensions,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../roomStore";
import { Avatar } from "./Avatar";
import MessageInteractions from "./MessageInteractions";
import { BottomReplyContainer } from "./BottomReplyContainer";
import { MessageReply } from "./MessageReply";
import { DeletedMessage } from "./DeletedMessage";
import {
  setActiveModal,
  setDeleteModal,
  setSelectedUser,
} from "../../roomStore/chatSettingsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
import { setActiveMessage, setEditAction } from "../../roomStore/roomsSlice";
import styled from "styled-components/native";
import { IUser, MessageProps } from "../../types/types";

const CustomMessageContainer = styled.View<{ isUser: boolean; reply?: number }>`
  flex-direction: row;
  padding: 10px;
  align-items: flex-end;
  justify-content: ${({ isUser }) => (isUser ? "flex-end" : "flex-start")};
  margin-bottom: ${(props) => !!props.reply && "20px"};
`;

const CustomMessageBubble = styled.View<{ isUser: boolean; deleted?: boolean }>`
  position: relative;
  max-width: 90%;
  min-width: 30%;
  padding: 10px;
  border-radius: 10px;
  border-bottom-left-radius: ${({ isUser }) => (isUser ? "10" : "0")}px;
  border-bottom-right-radius: ${({ isUser }) => (isUser ? "0" : "10")}px;
  background-color: ${({ isUser, deleted }) =>
    deleted ? "#f5f5f5" : isUser ? "#d1e7ff" : "#fff"};
`;

const CustomMessageText = styled.Text`
  font-size: 16px;
  color: #333;
`;

const CustomMessagePhoto = styled.Image`
  width: 40px;
  height: 40px;
  border-radius: 20px;
`;

const CustomMessagePhotoContainer = styled.TouchableOpacity`
  margin-right: 10px;
`;

const CustomUserName = styled.Text<{ color?: string }>`
  font-size: 14px;
  color: ${({ color }) => color || "#333"};
`;

const CustomMessageTimestamp = styled.Text`
  font-size: 12px;
  color: #999;
  margin-top: 5px;
  align-self: flex-end;
`;

const Message: React.FC<MessageProps> = ({ message, isUser, isReply }) => {
  const dispatch = useDispatch();
  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const [isPressed, setIsPressed] = useState(false);

  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const messageRef = useRef<View>(null);

  const handleUserAvatarClick = (user: IUser): void => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    dispatch(setSelectedUser(user));
  };

  const handleReplyMessage = () => {
    dispatch(setEditAction({ isEdit: false }));

    if (!isReply && message.mainMessage) {
      console.log("handleReplyMessage 2");
      const messageCore = JSON.parse(message.mainMessage);
      return dispatch(
        setActiveMessage({ id: messageCore.id, chatJID: messageCore.roomJid })
      );
    }

    return dispatch(
      setActiveMessage({ id: message.id, chatJID: message.roomJid })
    );
  };

  const handleDeleteMessage = () => {
    dispatch(
      setDeleteModal({
        isDeleteModal: true,
        roomJid: message.roomJid,
        messageId: message.id,
      })
    );
    setIsPressed(false);
  };

  const handleEditMessage = () => {
    dispatch(
      setEditAction({
        isEdit: true,
        roomJid: message.roomJid,
        messageId: message.id,
        text: message.body,
      })
    );
  };

  // const handleLongPress = () => {
  //   setIsPressed(true);
  //   console.log("setIsPressed", isPressed);
  // };

  const handleLongPress = () => {
    if (messageRef.current) {
      const nodeHandle = findNodeHandle(messageRef.current);
      if (nodeHandle) {
        UIManager.measure(nodeHandle, (x, y, width, height, pageX, pageY) => {
          const screenHeight = Dimensions.get("window").height;

          const enoughSpaceBelow = screenHeight - pageY - height > 150;
          setContextMenuPosition({
            x: pageX,
            y: enoughSpaceBelow ? pageY + height : pageY - 150,
          });
        });
      }
    }
    setIsPressed(true);
  };

  const handlePressOut = () => {
    setIsPressed(false);
  };

  return (
    <View style={styles.container}>
      {isPressed && <View style={styles.overlay} />}
      <CustomMessageContainer
        ref={messageRef}
        isUser={isUser}
        reply={message?.reply?.length}
        style={
          isPressed
            ? { transform: [{ scale: 1.05 }], paddingRight: 16 }
            : undefined
        }
      >
        {!isUser && (
          <CustomMessagePhotoContainer
            onPress={() => handleUserAvatarClick(message.user)}
          >
            {message.user?.profileImage ? (
              <CustomMessagePhoto source={{ uri: message.user.profileImage }} />
            ) : (
              <Avatar username={message.user.name} />
            )}
          </CustomMessagePhotoContainer>
        )}
        <TouchableWithoutFeedback
          onLongPress={handleLongPress}
          delayLongPress={500}
        >
          <CustomMessageBubble isUser={isUser} deleted={message.isDeleted}>
            {!isUser && (
              <CustomUserName color={config?.colors?.primary}>
                {message.user.name}
              </CustomUserName>
            )}
            {!isReply && message.mainMessage && (
              <MessageReply
                handleReplyMessage={handleReplyMessage}
                isUser={isUser}
                text={JSON.parse(message.mainMessage).text}
              />
            )}
            {message.isDeleted ? (
              <DeletedMessage />
            ) : (
              <CustomMessageText>{message.body}</CustomMessageText>
            )}
            <CustomMessageTimestamp>
              {message?.pending && "sending..."}
              {new Date(message.date).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </CustomMessageTimestamp>
            {message?.reply?.length ? (
              <BottomReplyContainer
                isUser={isUser}
                onClick={handleReplyMessage}
                reply={message?.reply}
              />
            ) : (
              <View />
            )}
          </CustomMessageBubble>
        </TouchableWithoutFeedback>
      </CustomMessageContainer>

      {/* {!config?.disableInteractions && ( */}
      {isPressed && (
        <MessageInteractions
          position={contextMenuPosition}
          isReply={isReply}
          isUser={isUser}
          message={message}
          closeMenu={() => setIsPressed(false)}
          handleReplyMessage={handleReplyMessage}
          handleDeleteMessage={handleDeleteMessage}
          handleEditMessage={handleEditMessage}
        />
      )}
    </View>
  );
};

export { Message };

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
    marginTop: 5,
    alignSelf: "flex-end",
  },
});
