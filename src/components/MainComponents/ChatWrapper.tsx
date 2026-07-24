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
import ConnectionBanner from './ConnectionBanner';
import {Message} from '../MessageBubble/Message';
import {IConfig, IRoom, MessageProps, ModalType, User} from '../../types/types';
import {useXmppClient} from '../../context/xmppProvider';
import LoginForm from '../AuthForms/Login';
import {RootState} from '../../roomStore';
import Loader from '../styled/Loader';
import {
  addRoom,
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
import {DeviceEventEmitter, Pressable, Text, View} from 'react-native';
import {pushLog as devPushLog} from '../../utils/devLogger';
import {normalizeRoomJid} from '../../helpers/normalizeRoomJid';
import {buildSeedRoom} from '../../helpers/buildSeedRoom';
import {InteractionsOverlayProvider} from '../MessageBubble/InteractionsOverlay';

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  // Pull the MUC roster as soon as a room opens (not just when the
  // profile modal is opened — see ChatProfileModal). Message sender
  // names fall back to the raw jid when a message doesn't carry its
  // own senderFirstName/senderLastName, and that fallback depends on
  // usersSet being populated; without this, any room the reader hasn't
  // separately opened the profile modal for shows jids instead of names.
  useEffect(() => {
    if (!client || !activeRoomJID) {return;}
    try {
      client.getRoomMembersStanza?.(activeRoomJID);
    } catch {
      /* non-fatal */
    }
  }, [client, activeRoomJID]);

  const seededRoomJID = useMemo(
    () =>
      roomJID
        ? normalizeRoomJid(roomJID, config?.xmppSettings?.conference)
        : '',
    [roomJID, config?.xmppSettings?.conference],
  );
  const seededRoomMissing = !!seededRoomJID && !rooms[seededRoomJID];
  useEffect(() => {
    if (!seededRoomJID || !seededRoomMissing) {return;}
    devPushLog(
      'rn',
      `ChatWrapper: seeding minimal room for single-room JID ${seededRoomJID}`,
    );
    dispatch(addRoom({roomData: buildSeedRoom(seededRoomJID)}));
  }, [seededRoomJID, seededRoomMissing, dispatch]);

  useEffect(() => {
    if (roomJID) {
      dispatch(
        setCurrentRoom({
          roomJID: normalizeRoomJid(roomJID, config?.xmppSettings?.conference),
        }),
      );
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
            setErrorMsg(
              'Could not authenticate against the server.\n' +
                'Check baseUrl, XMPP host fields, and the token / credentials you entered.'
            );
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
          setErrorMsg(
            'No authenticated user available.\n' +
              'For JWT login pass `jwtLogin.token`; for email login pass the `user={{email,password}}` prop and `customAppToken`.'
          );
          setShowModal(true);
          return;
        }

        // We have a user. Modal should be down.
        setShowModal(false);
        setErrorMsg(null);

        if (!client && !storedClient) {
          devPushLog('rn', 'ChatWrapper: initing xmpp client (legacy path)');
          // The outer `.then(c => {...})` used to lack a `.catch()` —
          // if initializeClient rejected (network / SASL), the outer
          // try/catch couldn't see it because the rejection happens in
          // the .then handler, not in the awaited promise itself.
          // Convert to await + try/catch.
          try {
            const c = await initializeClient(
              user.xmppUsername || user.defaultWallet?.walletAddress,
              user.xmppPassword,
              config?.xmppSettings
            );
            try {
              await c.getRoomsStanza();
              c.getChatsPrivateStoreRequestStanza().catch((err: unknown) =>
                console.warn('getChatsPrivateStoreRequestStanza failed', err)
              );
              dispatch(setStoreClient(c));
              setClient(c);
            } catch (err) {
              console.warn('getRoomsStanza failed', err);
            }
          } catch (err) {
            devPushLog('warn', 'initializeClient failed (legacy path)', err);
          }
          setInited(true);
          if (config?.refreshTokens?.enabled) {
            // refresh() is fire-and-forget but rejects on bad
            // refreshToken / network — surface via .catch instead of
            // leaving the rejection unhandled (was bug #4, id:2).
            refresh().catch((err) =>
              console.warn('refresh failed', err)
            );
          }
        } else if (storedClient) {
          devPushLog('rn', 'ChatWrapper: reusing storedClient');
          setClient(storedClient);
          if (!activeRoomJID) {
            storedClient.getRoomsStanza()
              .then(() => {
                storedClient.getChatsPrivateStoreRequestStanza().catch(
                  (err: unknown) =>
                    console.warn('getChatsPrivateStoreRequestStanza failed', err)
                );
              })
              .catch((err: unknown) => console.warn('getRoomsStanza failed', err));
          }
          setInited(true);
          if (config?.refreshTokens?.enabled) {
            refresh().catch((err) =>
              console.warn('refresh failed', err)
            );
          }
        } else if (client) {
          devPushLog('rn', 'ChatWrapper: reusing provider client');
          if (!activeRoomJID) {
            client.getRoomsStanza()
              .then(() => {
                client.getChatsPrivateStoreRequestStanza().catch(
                  (err: unknown) =>
                    console.warn('getChatsPrivateStoreRequestStanza failed', err)
                );
              })
              .catch((err: unknown) => console.warn('getRoomsStanza failed', err));
          }
          client.getChatsPrivateStoreRequestStanza().catch((err: unknown) =>
            console.warn('getChatsPrivateStoreRequestStanza failed', err)
          );
          setInited(true);
          if (config?.refreshTokens?.enabled) {
            refresh().catch((err) =>
              console.warn('refresh failed', err)
            );
          }
        }

        dispatch(setIsLoading({loading: false}));
      } catch (error) {
        devPushLog('error', 'ChatWrapper: init failed', error);
        const msg =
          (error as any)?.response?.data?.message ||
          (error as any)?.message ||
          String(error);
        setErrorMsg(`Init failed: ${msg}`);
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

  // Cache-first display (initBeforeLoad). The main effect above only marks
  // the chat `inited` once the provider bootstrap reaches 'ready' — which
  // waits on the cold XMPP connect. On re-entry that left the user staring
  // at a loader while fully-cached rooms/messages sat in redux-persist
  // ("pulls a new connection for 100 years"). Here we render the cached
  // content the instant rehydration lands; the live client gets wired by
  // the main effect when the connect completes (send/loadMore activate
  // then). Mirrors web showing cached rooms immediately + refreshing in
  // the background.
  useEffect(() => {
    if (!config?.initBeforeLoad || initMode !== 'provider') {return;}
    if (isInited || showModal) {return;}
    if (providerBootstrapStatus === 'failed') {return;}
    const haveCachedRooms = !!rooms && Object.keys(rooms).length > 0;
    const haveUser =
      !!user?.xmppUsername || !!user?.defaultWallet?.walletAddress;
    if (haveCachedRooms && haveUser) {
      devPushLog('rn', 'ChatWrapper: cache-first — showing persisted rooms while provider connects');
      setShowModal(false);
      setInited(true);
    }
  }, [
    config?.initBeforeLoad,
    initMode,
    isInited,
    showModal,
    providerBootstrapStatus,
    rooms,
    user?.xmppUsername,
    user?.defaultWallet?.walletAddress,
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
      {/* Connection/bootstrap error UI. For patient-facing apps the
          full-screen dark overlay reads as a crash, so
          `disableConnectionErrorOverlay` swaps it for a subtle inline
          "Connection lost. Retrying…" banner (and reconnect + re-join now
          recover automatically). */}
      {showModal && config?.disableConnectionErrorOverlay && <ConnectionBanner />}
      {showModal && !config?.disableConnectionErrorOverlay && (
        <Overlay>
          <View
            style={{
              padding: 20,
              backgroundColor: '#fff',
              borderRadius: 12,
              maxWidth: 320,
              alignItems: 'stretch',
            }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                marginBottom: 8,
                color: '#222',
              }}>
              Connection error
            </Text>
            <Text style={{fontSize: 13, color: '#444', marginBottom: 16}}>
              {errorMsg ?? 'Something went wrong while connecting to chat.'}
            </Text>
            <Pressable
              onPress={() => {
                setShowModal(false);
                setErrorMsg(null);
                setInited(false);
                // Signal a clean re-bootstrap. XmppProvider listens and
                // resets its state machine so the next effect run resolves
                // the user from scratch.
                DeviceEventEmitter.emit('ethora:retryBootstrap');
              }}
              style={({pressed}) => ({
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 6,
                backgroundColor: pressed ? '#0040A0' : '#0052CD',
                alignItems: 'center',
              })}>
              <Text style={{color: '#fff', fontWeight: '600'}}>Retry</Text>
            </Pressable>
          </View>
        </Overlay>
      )}
      <>
        {isInited ? (
          <ChatWrapperBox
            style={{
              ...MainComponentStyles,
            }}>
            {/* Host the message context menu in-tree (not a RN Modal) so
                opening it doesn't steal focus / dismiss the keyboard on
                Android. Wraps only the chat area — the global Modal /
                ModalWrapper below stay above it. */}
            <InteractionsOverlayProvider>
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
            </InteractionsOverlayProvider>
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
                compact
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
