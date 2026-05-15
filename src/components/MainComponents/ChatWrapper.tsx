import React, {FC, useEffect, useMemo, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import ChatRoom from './ChatRoom';
import {
  setActiveModal,
  setConfig,
  setDeleteModal,
  setStoreClient,
} from '../../roomStore/chatSettingsSlice';
import {ChatWrapperBox} from '../styled/ChatWrapperBox';
import {Overlay, StyledModal} from '../styled/MediaModal';
import {Message} from '../MessageBubble/Message';
import {IConfig, IRoom, MessageProps, ModalType, User} from '../../types/types';
import {useXmppClient} from '../../context/xmppProvider';
import LoginForm from '../AuthForms/Login';
import {RootState} from '../../roomStore';
import Loader from '../styled/Loader';
import {
  setCurrentRoom,
  setEditAction,
  setIsLoading,
  setLastViewedTimestamp,
} from '../../roomStore/roomsSlice';
import {refresh} from '../../networking/apiClient';
import RoomList from './RoomList';
import {StyledLoaderWrapper} from '../styled/StyledComponents';
import Modal from '../Modals/Modal/Modal';
import ThreadWrapper from '../Thread/ThreadWrapper';
import {ModalWrapper} from '../Modals/ModalWrapper/ModalWrapper';
import {useChatSettingState} from '../../hooks/useChatSettingState';
import {Text} from 'react-native';

interface ChatWrapperProps {
  token?: string;
  room?: IRoom;
  loginData?: {email: string; password: string};
  MainComponentStyles?: React.CSSProperties; //change to particular types
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

  const [isInited, setInited] = useState(false);
  const [showModal, setShowModal] = useState(false);
  // const [isModalDeleteOpen, setIsModalDeleteOpen] = useState(false);

  const [isChatVisible, setIsChatVisible] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  const handleItemClick = (value: boolean) => {
    setIsChatVisible(value);
  };

  const dispatch = useDispatch();
  const {
    client,
    initializeClient,
    setClient,
    providerBootstrapStatus,
    initMode,
  } = useXmppClient();

  const {rooms, activeRoomJID} = useSelector((state: RootState) => state.rooms);

  const activeMessage = useMemo(() => {
    if (activeRoomJID) {
      return rooms[activeRoomJID]?.messages?.find(
        message => message?.activeMessage,
      );
    }
  }, [rooms, activeRoomJID]);

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({roomJID: chat.jid}));
    activeRoomJID !== chat.jid &&
      dispatch(setIsLoading({chatJID: chat.jid, loading: true}));
    dispatch(setEditAction({isEdit: false}));
    handleItemClick(true);
  };

  const handleDeleteClick = () => {
    if (!client || !deleteModal?.roomJid || !deleteModal?.messageId) {
      dispatch(setDeleteModal({isDeleteModal: false}));
      return;
    }
    client.deleteMessageStanza(deleteModal.roomJid, deleteModal.messageId);
    dispatch(setDeleteModal({isDeleteModal: false}));
  };

  const handleCloseDeleteModal = () => {
    dispatch(setDeleteModal({isDeleteModal: false}));
  };

  useEffect(() => {
    return () => {
      if (client && user.xmppPassword === '') {
        console.log('closing client');
        client.close();
        setClient(null);
      }
    };
  }, [user.xmppPassword]);

  // Tell the XMPP client which room is currently active so the QoS
  // scheduler can prioritize its history fetches.
  useEffect(() => {
    if (!client) return;
    client.setActiveRoomJid?.(activeRoomJID || null);
  }, [client, activeRoomJID]);

  useEffect(() => {
    if (roomJID) {
      dispatch(setCurrentRoom({roomJID: roomJID}));
    }

    const initXmmpClient = async () => {
      dispatch(setConfig(config));
      try {
        if (!user.defaultWallet || user?.defaultWallet.walletAddress === '') {
          setShowModal(true);
          console.log('Error, no user');
        } else {
          // If XmppProvider owns bootstrap (config.initBeforeLoad=true),
          // wait for providerBootstrapStatus before doing anything ourselves.
          if (
            config?.initBeforeLoad &&
            initMode === 'provider' &&
            providerBootstrapStatus !== 'idle' &&
            providerBootstrapStatus !== 'ready' &&
            providerBootstrapStatus !== 'failed'
          ) {
            // running — wait, provider's effect will populate `client`.
            return;
          }
          if (
            config?.initBeforeLoad &&
            initMode === 'provider' &&
            providerBootstrapStatus === 'failed'
          ) {
            setShowModal(true);
            setInited(false);
            return;
          }
          if (!client && !storedClient) {
            setShowModal(false);

            console.log('No client, so initing one');
            await initializeClient(
              user.xmppUsername || user.defaultWallet?.walletAddress,
              user.xmppPassword,
              config?.xmppSettings,
            ).then(client => {
              client.getRoomsStanza().then(() => {
                client.getChatsPrivateStoreRequestStanza();
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
              });
            }
            setInited(true);
            {
              config?.refreshTokens?.enabled && refresh();
            }
          } else if (client) {
            if (!activeRoomJID) {
              client.getRoomsStanza().then(() => {
                client.getChatsPrivateStoreRequestStanza();
              });
            }
            client.getChatsPrivateStoreRequestStanza();
            setInited(true);
            {
              config?.refreshTokens?.enabled && refresh();
            }
          }
        }
        dispatch(setIsLoading({loading: false}));
      } catch (error) {
        setShowModal(true);
        setInited(false);
        dispatch(setIsLoading({loading: false}));
        console.log(error);
      }
    };

    initXmmpClient();
  }, [
    user.xmppPassword,
    user.defaultWallet,
    providerBootstrapStatus,
    initMode,
    config?.initBeforeLoad,
  ]);

  if (user.xmppPassword === '' && user.xmppUsername === '')
    return <LoginForm config={config} />;

  return (
    <>
      {showModal && (
        <Overlay>
          <StyledModal>
            <Text>There was an error. Please, refresh the page</Text>
          </StyledModal>
        </Overlay>
      )}
      <>
        {isInited ? (
          <ChatWrapperBox
            style={{
              ...MainComponentStyles,
            }}>
            <ChatWrapperBox
              style={{
                ...MainComponentStyles,
              }}>
              <ChatRoom
                CustomMessageComponent={CustomMessageComponent || Message}
              />
            </ChatWrapperBox>
          </ChatWrapperBox>
        ) : (
          <StyledLoaderWrapper>
            <Loader color={config?.colors?.primary} />
          </StyledLoaderWrapper>
        )}
      </>
    </>
  );
};

export {ChatWrapper};
