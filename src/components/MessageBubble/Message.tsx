import React, { useRef, useState } from "react";
import {
  View,
  TouchableWithoutFeedback,
  StyleSheet,
  findNodeHandle,
  UIManager,
  Dimensions,
  Text,
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
import MediaMessage from "../MainComponents/MediaMessage";
import MessageTranslations from "./MessageTranslations";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import { parseMessageBody } from '../../helpers/parseMessageBody';
import { useMessageHeapState } from '../../hooks/useMessageHeapState';
import { DoubleTick } from '../../assets/icons';

const CustomMessageContainer = styled.View<{ isUser: boolean; reply?: number }>`
  flex-direction: row;
  padding: 10px;
  align-items: flex-end;
  justify-content: ${({ isUser }) => (isUser ? "flex-end" : "flex-start")};
  margin-bottom: ${(props) => !!props.reply && "20px"};
`;

const CustomMessageBubble = styled.View<{
  isUser: boolean;
  deleted?: boolean;
  backgroundMessageUser?: string;
  backgroundMessage?: string;
}>`
  position: relative;
  max-width: 85%;
  min-width: 30%;
  padding: 10px;
  margin-right: ${({isUser}) => isUser ? '0' : '10px'};
  margin-left: ${({isUser}) => isUser ? '10px' : '0'};
  border-radius: 10px;
  border-bottom-left-radius: ${({ isUser }) => (isUser ? "10" : "0")}px;
  border-bottom-right-radius: ${({ isUser }) => (isUser ? "0" : "10")}px;
  background-color: ${({
    isUser,
    deleted,
    backgroundMessageUser,
    backgroundMessage,
  }) =>
    deleted
      ? "#f5f5f5"
      : isUser
      ? backgroundMessageUser || "#d1e7ff"
      : backgroundMessage || "#fff"};
`;

const CustomMessageText = styled.Text<{
  isUser: boolean;
  colorUser?: string;
  color?: string;
}>`
  font-size: 16px;
  color: ${({ color, colorUser, isUser }) =>
    isUser ? colorUser || "#333" : color || "#333"};
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
  font-weight: 500;
  color: ${({ color }) => color || "#333"};
`;

const CustomMessageTimestamp = styled.Text<{
  isUser?: boolean;
  color?: string;
  colorUser?: string;
}>`
  font-size: 12px;
  color: #999;
  color: ${({ isUser, color, colorUser }) =>
    isUser ? colorUser || "#999" : color || "#999"};
  margin-top: 5px;
  align-self: flex-end;
`;

const Message: React.FC<MessageProps> = ({ message, isUser, isReply }) => {
  const dispatch = useDispatch();
  const { config, langSource } = useChatSettingState();
  const { idSet } = useMessageHeapState();

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
      dispatch(
        setActiveMessage({ id: messageCore.id, chatJID: messageCore.roomJid })
      );

      return setIsPressed(false);
    }

    dispatch(setActiveMessage({ id: message.id, chatJID: message.roomJid }));

    return setIsPressed(false);
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

    return setIsPressed(false);
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

  const messageText = config?.messageTextFilter?.enabled
    ? parseMessageBody(config?.messageTextFilter.filterFunction(message.body))
    : parseMessageBody(message.body);

  const isPending = idSet.has(message.id) || message?.pending || false;

  return (
    <View>
      {isPressed && <View style={styles.overlay} />}\
      <View
        ref={messageRef}
        style={[
          styles.customMessageContainer,
          {
            justifyContent: isUser ? "flex-end" : "flex-start",
            marginBottom: !!message?.reply?.length || message?.reaction && !!Object.keys(message?.reaction)?.length
             ? 20 : 0,
          },
          isPressed
            ? { transform: [{ scale: 1.05 }], paddingRight: 16 }
            : undefined,
          // justify-content: ${({ isUser }) => (isUser ? "flex-end" : "flex-start")},
          // margin-bottom: ${(props) => !!props.reply && "20px"},
        ]}
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
          <CustomMessageBubble
            isUser={isUser}
            deleted={message.isDeleted}
            backgroundMessageUser={config?.messageColor?.backgroundMessageUser}
            backgroundMessage={config?.messageColor?.backgroundMessage}
          >
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
                color={config?.colors?.primary}
              />
            )}

            {message?.isMediafile === "true" && !message?.isDeleted ? (
              <MediaMessage
                mimeType={message.mimetype}
                messageText={message.locationPreview}
                location={message?.location}
                message={message}
              />
            ) : (
              <>
                {message.isDeleted && message.id !== "delimiter-new" ? (
                  <DeletedMessage />
                ) : (
                  <CustomMessageText
                    isUser={isUser}
                    colorUser={config?.messageColor?.colorUser}
                    color={config?.messageColor?.color}
                  >
                    <Text>{messageText}</Text>
                  </CustomMessageText>
                )}
              </>
            )}
            {config?.enableTranslates && (
              <MessageTranslations
                message={message}
                config={config}
                langSource={langSource}
              />
            )}
            <CustomMessageTimestamp>
            {!config?.disableSentLogic && isUser && isPending && 'sending...'}
            {new Date(message.date).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {!config?.disableSentLogic && isUser && !isPending && (
              <DoubleTick />
            )}
          </CustomMessageTimestamp>
            {message?.reply?.length && message?.reply?.length > 0 ? (
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
      </View>
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
  customMessageContainer: {
    flexDirection: "row",
    padding: 10,
    alignItems: "flex-end",
    position: "relative",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    // backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
    marginTop: 5,
    alignSelf: "flex-end",
  },
});
