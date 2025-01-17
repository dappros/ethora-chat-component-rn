/** @format */

import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import ChatRoom from "./ChatRoom";
import {
  setActiveModal,
  setConfig,
  setDeleteModal,
  setStoreClient,
} from "../../roomStore/chatSettingsSlice";
import { ChatWrapperBox } from "../styled/ChatWrapperBox";
import { Overlay, StyledModal } from "../styled/MediaModal";
import { Message } from "../MessageBubble/Message";
import {
  IConfig,
  IRoom,
  MessageProps,
  ModalType,
  User,
} from "../../types/types";
import { useXmppClient } from "../../context/xmppProvider";
import LoginForm from "../AuthForms/Login";
import Loader from "../styled/Loader";
import {
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
import { AppState, Linking, View, ViewStyle } from "react-native";
import useMessageLoaderQueue from "../../hooks/useMessageLoaderQueue";
import { useRoomState } from "../../hooks/useRoomState";

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
  const {
    user,
    activeModal,
    deleteModal,
    client: storedClient,
  } = useChatSettingState();
  const { roomsList, loading, globalLoading, activeRoomJID } = useRoomState();

  const [isInited, setInited] = useState(false);
  const [showModal, setShowModal] = useState(false);
  // const [isModalDeleteOpen, setIsModalDeleteOpen] = useState(false);

  const [isChatVisible, setIsChatVisible] = useState(false);

  const handleItemClick = (value: boolean) => {
    setIsChatVisible(value);
  };

  const dispatch = useDispatch();
  const { client, initializeClient, setClient } = useXmppClient();

  const activeMessage = useMemo(() => {
    if (activeRoomJID) {
      return roomsList[activeRoomJID]?.messages?.find(
        (message) => message?.activeMessage
      );
    }
  }, [Object.keys(roomsList).length, activeRoomJID]);

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({ roomJID: chat.jid }));
    activeRoomJID !== chat.jid &&
      dispatch(setIsLoading({ chatJID: chat.jid, loading: true }));
    dispatch(setEditAction({ isEdit: false }));
    handleItemClick(true);
  };

  const handleDeleteClick = () => {
    client.deleteMessageStanza(deleteModal?.roomJid!, deleteModal?.messageId!);
    dispatch(setDeleteModal({ isDeleteModal: false }));
  };

  const handleCloseDeleteModal = () => {
    dispatch(setDeleteModal({ isDeleteModal: false }));
  };

  useEffect(() => {
    return () => {
      if (client && user.xmppPassword === "") {
        console.log("closing client");
        client.close();
        setClient(null);
      }
    };
  }, [user.xmppPassword]);

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (url) {
        const urlObj = new URL(url);
        const searchParams = urlObj.searchParams;
        const chatId = searchParams.get("chatId");

        if (chatId) {
          const cleanChatId = chatId.split("@")[0];
          dispatch(
            setCurrentRoom({ roomJID: cleanChatId + CONFERENCE_DOMAIN })
          );
        }
      }
    };

    Linking.getInitialURL()
      .then(handleUrl)
      .catch((err) => {
        console.error("Error fetching initial URL:", err);
      });

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (roomJID) {
      dispatch(setCurrentRoom({ roomJID: roomJID }));
    }

    const initXmmpClient = async () => {
      dispatch(setConfig(config));
      dispatch(setIsLoading({ loading: true }));
      try {
        if (!user.defaultWallet || user?.defaultWallet.walletAddress === "") {
          setShowModal(true);
          console.log("Error, no user");
        } else {
          if (!client && !storedClient) {
            setShowModal(false);

            console.log("No client, so initing one");
            await initializeClient(
              user.defaultWallet?.walletAddress,
              user.xmppPassword,
              config?.xmppSettings
            ).then((client) => {
              client.getRoomsStanza().then(() => {
                client.getChatsPrivateStoreRequestStanza();
                client.setVCardStanza(`${user.firstName} ${user.lastName}`);
                dispatch(setStoreClient(client));
                setClient(client);
              });
            });
            setInited(true);
            {
              config?.refreshTokens?.enabled && refresh();
            }
          } else if (storedClient) {
            setClient(storedClient);
            if (!activeRoomJID) {
              storedClient.getRoomsStanza().then(() => {
                storedClient.getChatsPrivateStoreRequestStanza();
                storedClient.setVCardStanza(
                  `${user.firstName} ${user.lastName}`
                );
              });
            }
            setInited(true);
            {
              config?.refreshTokens?.enabled && refresh();
            }
          } else {
            if (!activeRoomJID) {
              client.getRoomsStanza().then(() => {
                client.getChatsPrivateStoreRequestStanza();
                client.setVCardStanza(`${user.firstName} ${user.lastName}`);
              });
            }
            client.getChatsPrivateStoreRequestStanza();
            setInited(true);
            {
              config?.refreshTokens?.enabled && refresh();
            }
          }
        }
        dispatch(setIsLoading({ loading: false }));
      } catch (error) {
        setShowModal(true);
        setInited(false);
        dispatch(setIsLoading({ loading: false }));
        console.log(error);
      }
    };

    initXmmpClient();
  }, [user.xmppPassword, user.defaultWallet]);

  // functionality to handle unreadmessages if user leaves tab
  const updateLastReadTimeStamp = () => {
    if (client) {
      client.actionSetTimestampToPrivateStoreStanza(
        room?.jid || roomJID || "",
        new Date().getTime()
      );
    }
    dispatch(
      setLastViewedTimestamp({
        chatJID: room?.jid || roomJID,
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

  const queueMessageLoader = useCallback(
    async (chatJID: string, max: number) => {
      try {
        client?.getHistoryStanza(chatJID, max);
      } catch (error) {
        console.log("Error in loading queue messages");
      }
    },
    [globalLoading, loading, isInited]
  );

  useMessageLoaderQueue(
    Object.keys(roomsList),
    globalLoading,
    loading,
    queueMessageLoader,
    isInited
  );

  if (user.xmppPassword === "" && user.xmppUsername === "")
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
        {isInited ? (
          <ChatWrapperBox
            style={{
              ...MainComponentStyles,
            }}
          >
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
