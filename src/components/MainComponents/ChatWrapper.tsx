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
import {pushLog as devPushLog} from '../../utils/devLogger';

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
    if (!client) {return;}
    client.setActiveRoomJid?.(activeRoomJID || null);
  }, [client, activeRoomJID]);

  useEffect(() => {
    if (roomJID) {
      dispatch(setCurrentRoom({roomJID: roomJID}));
    }

    const initXmmpClient = async () => {
      // Only sync config to redux if we have one — passing `undefined`
      // wipes whatever XmppProvider already set up.
      if (config) {dispatch(setConfig(config));}
      try {
        const hasUser =
          !!user?.defaultWallet?.walletAddress &&
          user?.defaultWallet.walletAddress !== '' &&
          !!user?.xmppPassword;

        // initBeforeLoad path — provider owns auth + xmpp connect; we just wait.
        if (config?.initBeforeLoad && initMode === 'provider') {
          if (providerBootstrapStatus === 'failed') {
            devPushLog('error', 'ChatWrapper: bootstrap failed');
            setShowModal(true);
            setInited(false);
            return;
          }
          if (providerBootstrapStatus !== 'ready') {
            // 'idle' or 'running' → just wait; effect will re-run when status flips.
            devPushLog(
              'rn',
              `ChatWrapper: waiting for provider (${providerBootstrapStatus})`
            );
            return;
          }
          // ready — fall through to client wiring below
        }

        if (!hasUser) {
          // No user yet. In initBeforeLoad mode this is normal during the
          // bootstrap window; show the loader (no modal). In legacy mode
          // it's an error.
          if (config?.initBeforeLoad) {
            devPushLog('rn', 'ChatWrapper: no user yet, awaiting provider');
            setShowModal(false);
            return;
          }
          devPushLog('error', 'ChatWrapper: no user (legacy login path)');
          setShowModal(true);
          return;
        }

        // We have a user. Modal should be down.
        setShowModal(false);

        if (!client && !storedClient) {
          devPushLog('rn', 'ChatWrapper: initing xmpp client (legacy path)');
          await initializeClient(
            user.xmppUsername || user.defaultWallet?.walletAddress,
            user.xmppPassword,
            config?.xmppSettings
          ).then(c => {
            c.getRoomsStanza().then(() => {
              c.getChatsPrivateStoreRequestStanza();
              dispatch(setStoreClient(c));
              setClient(c);
            });
          });
          setInited(true);
          if (config?.refreshTokens?.enabled) {refresh();}
        } else if (storedClient) {
          devPushLog('rn', 'ChatWrapper: reusing storedClient');
          setClient(storedClient);
          if (!activeRoomJID) {
            storedClient.getRoomsStanza().then(() => {
              storedClient.getChatsPrivateStoreRequestStanza();
            });
          }
          setInited(true);
          if (config?.refreshTokens?.enabled) {refresh();}
        } else if (client) {
          devPushLog('rn', 'ChatWrapper: reusing provider client');
          if (!activeRoomJID) {
            client.getRoomsStanza().then(() => {
              client.getChatsPrivateStoreRequestStanza();
            });
          }
          client.getChatsPrivateStoreRequestStanza();
          setInited(true);
          if (config?.refreshTokens?.enabled) {refresh();}
        }

        dispatch(setIsLoading({loading: false}));
      } catch (error) {
        devPushLog('error', 'ChatWrapper: init failed', error);
        setShowModal(true);
        setInited(false);
        dispatch(setIsLoading({loading: false}));
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

  // Skip the legacy email/password LoginForm entirely when XmppProvider
  // is driving auth via initBeforeLoad — the bootstrap effect will
  // populate the user shortly. Showing LoginForm here causes a flicker
  // and (worse) a stale form that races against the in-flight bootstrap.
  if (
    user.xmppPassword === '' &&
    user.xmppUsername === '' &&
    !config?.initBeforeLoad
  )
    {return <LoginForm config={config} />;}

  // Mirror the web layout: when `disableRooms` is false and the
  // consumer didn't preselect a `roomJID`, show the RoomList until the
  // user picks one; then show the chat with a back button to return to
  // the list. With `roomJID` or `disableRooms`, skip the list entirely.
  const showRoomList =
    !config?.disableRooms && !roomJID && !activeRoomJID;

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
            {showRoomList ? (
              <RoomList
                chats={Object.values(rooms)}
                onRoomClick={handleChangeChat}
              />
            ) : (
              <ChatWrapperBox
                style={{
                  ...MainComponentStyles,
                }}>
                <ChatRoom
                  CustomMessageComponent={CustomMessageComponent || Message}
                  handleBackClick={
                    roomJID || config?.disableRooms
                      ? undefined
                      : () => {
                          dispatch(setCurrentRoom({ roomJID: '' }));
                        }
                  }
                />
              </ChatWrapperBox>
            )}
            <Modal
              modal={activeModal}
              setOpenModal={(value?: ModalType) =>
                dispatch(setActiveModal(value))
              }
            />
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
