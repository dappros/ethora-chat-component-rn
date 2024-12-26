import React, { forwardRef, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
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

const CustomMessageContainer = styled.View<{ isUser: boolean }>`
  flex-direction: row;
  padding: 10px;
  align-items: flex-end;
  justify-content: ${({ isUser }: { isUser: boolean }) =>
    isUser ? "flex-end" : "flex-start"};
`;

const CustomMessageBubble = styled.View<{ isUser: boolean; deleted?: boolean }>`
  max-width: 70%;
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

const Message: React.FC<MessageProps> = forwardRef<any, MessageProps>(
  ({ message, isUser, isReply }, ref) => {
    const dispatch = useDispatch();
    const config = useSelector(
      (state: RootState) => state.chatSettingStore.config
    );

    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const handleUserAvatarClick = (user: IUser): void => {
      dispatch(setActiveModal(MODAL_TYPES.PROFILE));
      dispatch(setSelectedUser(user));
    };

    const handleReplyMessage = () => {
      dispatch(setEditAction({ isEdit: false }));

      if (!isReply && message.mainMessage) {
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

    return (
      <CustomMessageContainer isUser={isUser} ref={ref}>
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
        <TouchableWithoutFeedback>
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
          </CustomMessageBubble>
        </TouchableWithoutFeedback>
      </CustomMessageContainer>
    );
  }
);

export { Message };
