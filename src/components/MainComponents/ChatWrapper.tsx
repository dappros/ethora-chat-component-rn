/** @format */

import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import ChatRoom from "./ChatRoom";
import {
  setActiveModal,
  setDeleteModal,
} from "../../roomStore/chatSettingsSlice";
import { ChatWrapperBox } from "../styled/ChatWrapperBox";
import { Message } from "../MessageBubble/Message";
import { IConfig, IRoom, MessageProps, ModalType } from "../../types/types";
import LoginForm from "../AuthForms/Login";
import Loader from "../styled/Loader";
import {
  clearPendingNotificationJid,
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
import { AppState, StatusBar, Text, View, ViewStyle } from "react-native";
import { useRoomState } from "../../hooks/useRoomState";
import useChatWrapperInit from "../../hooks/useChatWrapperInit.ts";
import { useQRCodeChat } from "../../hooks/useQRCodeChatHandler.ts";
import { RootState } from "../../roomStore/index.ts";
import { Overlay, StyledModal } from "../styled/MediaModal.tsx";
import { useHeapSender } from "../../hooks/useHeapSender";
import ConnectionBanner from "./ConnectionBanner";
import usePendingNotification from "../../hooks/usePendingNotification.ts";

interface ChatWrapperProps {
  token?: string;
  room?: IRoom;
  loginData?: { email: string; password: string };
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  CustomInputComponent?: React.ComponentType<any>;
  CustomScrollableArea?: React.ComponentType<any>;
  CustomDaySeparator?: React.ComponentType<any>;
  CustomNewMessageLabel?: React.ComponentType<any>;
  config?: IConfig;
  roomJID?: string;
}

const ChatWrapper: FC<ChatWrapperProps> = ({
  MainComponentStyles,
  CustomMessageComponent,
  CustomInputComponent,
  CustomScrollableArea,
  CustomDaySeparator,
  CustomNewMessageLabel,
  room,
  config,
  roomJID,
}) => {
  const {
    user,
    activeModal,
    deleteModal,
    config: storeConfig,
  } = useChatSettingState();

  const effectiveConfig = config || storeConfig;

  const [isChatVisible, setIsChatVisible] = useState(false);

  const handleItemClick = useCallback((value: boolean) => {
    setIsChatVisible(value);
  }, []);

  const conferenceServer = effectiveConfig?.xmppSettings?.conference;

  const dispatch = useDispatch();
  const setCurrentRoomCallback = useCallback(
    (params: { roomJID: string | null }) => {
      dispatch(setCurrentRoom(params));
    },
    [dispatch]
  );

  const { wasAutoSelected } = useQRCodeChat(
    setCurrentRoomCallback,
    conferenceServer
  );

  const { rooms, activeRoomJID, reportRoom } = useSelector(
    (state: RootState) => state.rooms
  );
  const { roomsList, loading, globalLoading, loadingText } = useRoomState();

  const roomsListCount = useMemo(() => {
    return roomsList ? Object.keys(roomsList).length : 0;
  }, [roomsList]);

  const activeMessage = useMemo(() => {
    if (activeRoomJID) {
      return rooms[activeRoomJID]?.messages?.find(
        (message) => message?.activeMessage
      );
    }
  }, [rooms, activeRoomJID]);

  const handleDeleteClick = () => {
    if (!deleteModal || !client) {
      return;
    }

    if (deleteModal.roomJid && deleteModal.messageId) {
      client.deleteMessageStanza(deleteModal.roomJid, deleteModal.messageId);
    }

    dispatch(setDeleteModal({ isDeleteModal: false }));
  };

  const handleCloseDeleteModal = () => {
    dispatch(setDeleteModal({ isDeleteModal: false }));
  };

  const { client, inited, isRetrying, showModal, isConnectionLost } =
    useChatWrapperInit({
      roomJID,
      wasAutoSelected,
      config: effectiveConfig || {},
    });

  const handleChangeChat = useCallback(
    (chat: IRoom) => {
      dispatch(setCurrentRoom({ roomJID: null }));
      dispatch(setIsLoading({ chatJID: chat.jid, loading: true }));
      dispatch(setCurrentRoom({ roomJID: chat.jid }));
      dispatch(setEditAction({ isEdit: false }));
      handleItemClick(true);
      if (!chat?.historyComplete && chat.messages?.length < 30) {
        client?.getHistoryStanza(chat.jid, 30);
      }
    },
    [dispatch, handleItemClick, client]
  );

  const { sendHeapMessages } = useHeapSender(client);

  const { pendingNotificationJid } = usePendingNotification();
  
  useEffect(() => {
    if (pendingNotificationJid && rooms[pendingNotificationJid] && inited && client) {
      console.log('[ChatWrapper] Opening room from pending notification:', pendingNotificationJid);
      const room = rooms[pendingNotificationJid];
      if (room) {
        handleChangeChat(room);
        dispatch(clearPendingNotificationJid());
      }
    }
  }, [pendingNotificationJid, rooms, inited, client, dispatch]);

  useEffect(() => {
    if (inited && client) {
      sendHeapMessages();
    }
  }, [inited, client]);

  const hasAutoShownRef = useRef(false);
  useEffect(() => {
    if (
      inited &&
      roomJID &&
      activeRoomJID &&
      !isChatVisible &&
      !hasAutoShownRef.current
    ) {
      hasAutoShownRef.current = true;
      setIsChatVisible(true);
    }
  }, [inited, roomJID, activeRoomJID, isChatVisible]);

  const updateLastReadTimeStamp = () => {
    if (client) {
      client.actionSetTimestampToPrivateStoreStanza(
        room?.jid || roomJID || "",
        new Date().getTime()
      );
    }
    dispatch(
      setLastViewedTimestamp({
        chatJID: room?.jid || roomJID || "",
        timestamp: new Date().getTime(),
      })
    );
  };

  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === "background") {
        updateLastReadTimeStamp();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    return () => {
      subscription.remove();
    };
  }, [client, room?.jid]);

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

  if (effectiveConfig?.enableRoomsRetry?.enabled && isRetrying === "norooms") {
    return (
      <StyledLoaderWrapper
        style={{ alignItems: "center", flexDirection: "column", gap: "10px" }}
      >
        <Text>
          {effectiveConfig?.enableRoomsRetry?.helperText ||
            "We couldn't create any chat room."}
        </Text>
      </StyledLoaderWrapper>
    );
  }

  if (effectiveConfig?.enableRoomsRetry?.enabled && isRetrying) {
    return (
      <StyledLoaderWrapper
        style={{ alignItems: "center", flexDirection: "column", gap: "10px" }}
      >
        <Loader color={config?.colors?.primary} />
        {loadingText && <Text>{loadingText}</Text>}
      </StyledLoaderWrapper>
    );
  }

  if (user.xmppPassword === "" && user.xmppUsername === "") {
    if (__DEV__) {
      console.log("🔵 ChatWrapper: No user credentials, showing LoginForm");
    }
    return <LoginForm config={config} />;
  }

  // Removed excessive logging to prevent re-renders

  return (
    <View style={{ flex: 1 }}>
      {showModal && (
        <Overlay>
          <StyledModal>
            There was an error. Please, refresh the page
          </StyledModal>
        </Overlay>
      )}
      {isConnectionLost && !inited && <ConnectionBanner />}
      <>
        {inited ? (
          <ChatWrapperBox
            style={{
              ...MainComponentStyles,
              flex: 1,
            }}
          >
            <StatusBar
              barStyle="dark-content"
              backgroundColor="#fff"
              translucent={false}
            />
            {!effectiveConfig?.disableRooms &&
              roomsList &&
              Object.keys(roomsList).length > 0 &&
              !isChatVisible && (
                <RoomList
                  chats={Object.values(roomsList)}
                  onRoomClick={handleChangeChat}
                />
              )}
            {isChatVisible && activeRoomJID ? (
              <ChatRoom
                CustomMessageComponent={CustomMessageComponent || Message}
                CustomInputComponent={CustomInputComponent}
                CustomScrollableArea={CustomScrollableArea}
                CustomDaySeparator={CustomDaySeparator}
                CustomNewMessageLabel={CustomNewMessageLabel}
                handleBackClick={handleItemClick}
                eventHandlers={effectiveConfig?.eventHandlers}
              />
            ) : null}
            {!effectiveConfig?.disableRooms &&
              roomsList &&
              Object.keys(roomsList).length === 0 &&
              !isChatVisible && (
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    padding: 20,
                  }}
                >
                  <Text>No rooms available. Waiting for rooms to load...</Text>
                  <Loader color={effectiveConfig?.colors?.primary} />
                </View>
              )}
            {effectiveConfig?.disableRooms &&
              !isChatVisible &&
              !activeRoomJID && (
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    padding: 20,
                  }}
                >
                  <Text>Waiting for room to initialize...</Text>
                  <Loader color={effectiveConfig?.colors?.primary} />
                </View>
              )}
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
            <Text style={{ marginTop: 10 }}>Initializing chat...</Text>
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
