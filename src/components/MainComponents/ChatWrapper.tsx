/** @format */

import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import ChatRoom from "./ChatRoom";
import {
  setActiveModal,
  setConfig,
  setDeleteModal,
} from "../../roomStore/chatSettingsSlice";
import { ChatWrapperBox } from "../styled/ChatWrapperBox";
import { Message } from "../MessageBubble/Message";
import {
  IConfig,
  IRoom,
  MessageProps,
  ModalType,
  User,
  XmppClientInterface,
} from "../../types/types";
import { useXmppClient } from "../../context/xmppProvider";
import LoginForm from "../AuthForms/Login";
import Loader from "../styled/Loader";
import {
  addRoom,
  setCurrentRoom,
  setEditAction,
  setIsLoading,
  setLastViewedTimestamp,
} from "../../roomStore/roomsSlice";
import { refresh } from "../../networking/apiClient";
import RoomList from "./RoomList";
import { StyledLoaderWrapper } from "../styled/StyledComponents";
import Modal from "../Modals/Modal/Modal";
import ThreadWrapper from "../Thread/ThreadWrapper";
import { ModalWrapper } from "../Modals/ModalWrapper/ModalWrapper";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import { CONFERENCE_DOMAIN } from "../../helpers/constants/PLATFORM_CONSTANTS";
import { AppState, Linking, StatusBar, Text, View, ViewStyle } from "react-native";
import useMessageLoaderQueue from "../../hooks/useMessageLoaderQueue";
import { useRoomState } from "../../hooks/useRoomState";
import useChatWrapperInit from "../../hooks/useChatWrapperInit.ts";
import { useQRCodeChat } from "../../hooks/useQRCodeChatHandler.ts";
import { RootState } from "../../roomStore/index.ts";
import { Overlay, StyledModal } from "../styled/MediaModal.tsx";
import { useHeapSender } from '../../hooks/useHeapSender';

interface ChatWrapperProps {
  token?: string;
  room?: IRoom;
  loginData?: { email: string; password: string };
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
  roomJID?: string;
}

const ChatWrapper: FC<ChatWrapperProps> = ({
  MainComponentStyles,
  CustomMessageComponent,
  room,
  config,
  roomJID,
}) => {
  const { user, activeModal, deleteModal } = useChatSettingState();

  const [isChatVisible, setIsChatVisible] = useState(false);
  
  const handleItemClick = (value: boolean) => {
    setIsChatVisible(value);
  };

  const conferenceServer = config?.xmppSettings?.conference;

  const dispatch = useDispatch();
  const { wasAutoSelected } = useQRCodeChat(
    (params) => dispatch(setCurrentRoom(params)),
    conferenceServer
  );

  const { rooms, activeRoomJID, reportRoom } = useSelector(
    (state: RootState) => state.rooms
  );
  const { roomsList, loading, globalLoading, loadingText } = useRoomState();

  const activeMessage = useMemo(() => {
    if (activeRoomJID) {
      return rooms[activeRoomJID]?.messages?.find(
        (message) => message?.activeMessage
      );
    }
  }, [rooms, activeRoomJID]);

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({ roomJID: null }));
    dispatch(setIsLoading({ chatJID: chat.jid, loading: true }));
    dispatch(setCurrentRoom({ roomJID: chat.jid }));
    dispatch(setEditAction({ isEdit: false }));
    handleItemClick(true);
    if (!chat?.historyComplete && chat.messages?.length < 30) {
      client?.getHistoryStanza(chat.jid, 30);
    }
  };

  const handleDeleteClick = () => {
    if(!deleteModal || !client) {
      return;
    }

    if(deleteModal.roomJid && deleteModal.messageId) {
      client.deleteMessageStanza(deleteModal.roomJid, deleteModal.messageId);
    }

    dispatch(setDeleteModal({ isDeleteModal: false }));
  };

  const handleCloseDeleteModal = () => {
    dispatch(setDeleteModal({ isDeleteModal: false }));
  };

  const { client, inited, isRetrying, showModal } = useChatWrapperInit({
    roomJID,
    wasAutoSelected,
    config: config || {},
  });

  const { sendHeapMessages } = useHeapSender(client);

  useEffect(() => {
    if (inited && client) {
      sendHeapMessages();
    }
  }, [inited, client]);

  // upd logic to use
  // const queueMessageLoader = useCallback(
  //   async (chatJID: string, max: number) => {
  //     try {
  //       return await client?.getHistoryStanza(chatJID, max);
  //     } catch (error) {
  //       console.log('Error in loading queue messages', error);
  //     }
  //   },
  //   [globalLoading, loading, !!client]
  // );

  // useMessageLoaderQueue(
  //   Object.keys(roomsList),
  //   roomsList,
  //   globalLoading,
  //   loading,
  //   queueMessageLoader
  // );

  if (config?.enableRoomsRetry?.enabled && isRetrying === 'norooms') {
    return (
      <StyledLoaderWrapper
        style={{ alignItems: 'center', flexDirection: 'column', gap: '10px' }}
      >
        {config.enableRoomsRetry.helperText ||
          "We couldn't create any chat room."}
      </StyledLoaderWrapper>
    );
  }

  if (config?.enableRoomsRetry?.enabled && isRetrying) {
    return (
      <StyledLoaderWrapper
        style={{ alignItems: 'center', flexDirection: 'column', gap: '10px' }}
      >
        <Loader color={config?.colors?.primary} />
        {loadingText && <Text>{loadingText}</Text>}
      </StyledLoaderWrapper>
    );
  }

  if (user.xmppPassword === '' && user.xmppUsername === '')
    return <LoginForm config={config} />;

  return (
    <View>
      {showModal && (
        <Overlay>
          <StyledModal>
            There was an error. Please, refresh the page
          </StyledModal>
        </Overlay>
      )}
      <>
        {inited ? (
          <ChatWrapperBox
            style={{
              ...MainComponentStyles,
            }}
          >
            <StatusBar
              barStyle="dark-content"
              backgroundColor="#fff"
              translucent={false}
            />
            {!config?.disableRooms && roomsList && !isChatVisible && (
              <RoomList
                chats={Object.values(roomsList)}
                onRoomClick={handleChangeChat}
              />
            )}
            {isChatVisible ? (
              <ChatRoom
                CustomMessageComponent={CustomMessageComponent || Message}
                handleBackClick={handleItemClick}
              />
            ) : null}
            {isChatVisible && activeMessage?.activeMessage ? (
              <ThreadWrapper
                activeMessage={activeMessage}
                user={user}
                customMessageComponent={CustomMessageComponent || Message}
              />
            ) : null}
            <Modal
              modal={activeModal}
              setOpenModal={(value?: ModalType) =>
                dispatch(setActiveModal(value))
              }
            />
          </ChatWrapperBox>
        ) : (
          <StyledLoaderWrapper>
            <Loader color={config?.colors?.primary} />
          </StyledLoaderWrapper>
        )}
      </>
      {deleteModal?.isDeleteModal && (
        <ModalWrapper
          title="Delete Message"
          description="Are you sure you want to delete this message?"
          buttonText="Delete"
          backgroundColorButton="#E53935"
          handleClick={handleDeleteClick}
          handleCloseModal={handleCloseDeleteModal}
        />
      )}
    </View>
  );
};

export { ChatWrapper };
