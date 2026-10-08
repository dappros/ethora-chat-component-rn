import React, {FC, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import ChatRoom from './ChatRoom';
import {RoomStack, RoomStackHandle} from './RoomStack';
import {
  setActiveModal,
  setConfig,
  setDeleteModal,
  setLangSource,
  setStoreClient,
} from '../../roomStore/chatSettingsSlice';
import {
  resolveExternalReaderLocaleLangSource,
  resolveLegacyTranslatesLangSource,
} from '../../helpers/resolveLangSource';
import {ChatWrapperBox} from '../styled/ChatWrapperBox';
import {Overlay, StyledModal} from '../styled/MediaModal';
import ConnectionBanner from './ConnectionBanner';
import {Message} from '../MessageBubble/Message';
import {IConfig, IRoom, MessageProps, ModalType, User} from '../../types/types';
import {useXmppClient, SESSION_LOST_EVENT} from '../../context/xmppProvider';
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
import {refreshAuthTokensQuietly} from '../../networking/authRefresh';
import RoomList from './RoomList';
import {StyledLoaderWrapper} from '../styled/StyledComponents';
import Modal from '../Modals/Modal/Modal';
import ThreadWrapper from '../Thread/ThreadWrapper';
import {ModalWrapper} from '../Modals/ModalWrapper/ModalWrapper';
import {useChatSettingState} from '../../hooks/useChatSettingState';
import {useTheme} from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { usePendingNotification } from '../../hooks/usePendingNotification';
import {DeviceEventEmitter, Keyboard, Pressable, Text, View} from 'react-native';
import {pushLog as devPushLog} from '../../utils/devLogger';
import {normalizeRoomJid} from '../../helpers/normalizeRoomJid';
import {buildSeedRoom} from '../../helpers/buildSeedRoom';
import {shallowEqual} from '../../helpers/shallowEqual';
import {InteractionsOverlayProvider} from '../MessageBubble/InteractionsOverlay';
import {useJumpThread} from '../../helpers/jumpThread';

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

  usePendingNotification();
  const theme = useTheme();
  const t = useT();
  const roomStackRef = useRef<RoomStackHandle>(null);
  // Stable, so ChatRoom's React.memo holds across this root's re-renders.
  // (A hook: must stay above the early LoginForm return.)
  const popRoom = useCallback(() => roomStackRef.current?.pop(), []);

  const [isInited, setInited] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Set when the session ended on its own (the password is gone for
  // good): the overlay then says so instead of "Connection error".
  const [sessionLost, setSessionLost] = useState(false);

  // The host may keep <Chat> mounted after the session ended: say what
  // happened on the chat's own screen, with a way to try again (the
  // host's refresh may work later, or the host may have signed in anew).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(SESSION_LOST_EVENT, () => {
      setSessionLost(true);
      setErrorMsg(null);
      setShowModal(true);
      setInited(false);
    });
    return () => sub.remove();
  }, []);
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

  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const activeRoomJID = useSelector(
    (state: RootState) => state.rooms.activeRoomJID,
  );
  const activeRoomMessages = useSelector((state: RootState) =>
    activeRoomJID ? state.rooms.rooms[activeRoomJID]?.messages : undefined,
  );

  // The thread's parent: the live message flagged active or, when the thread
  // was opened on a message that exists only in a jump window (or that a jump
  // to a thread reply fetched), the window's copy or the one kept by
  // helpers/jumpThread, which outlives the window. Reads the active room's
  // message list (granular), not the whole rooms map.
  const jumpWindow = useSelector((state: RootState) => state.rooms.jumpWindow);
  const jumpThread = useJumpThread();
  const activeMessage = useMemo(() => {
    if (!activeRoomJID) {return undefined;}
    const live = activeRoomMessages?.find(message => message?.activeMessage);
    if (live) {return live;}
    if (jumpWindow && jumpWindow.roomJID === activeRoomJID) {
      const inWindow = jumpWindow.messages.find(
        message => message?.activeMessage,
      );
      if (inWindow) {return inWindow;}
    }
    if (jumpThread?.parent && jumpThread.roomJID === activeRoomJID) {
      return {...jumpThread.parent, activeMessage: true};
    }
    return undefined;
  }, [activeRoomMessages, activeRoomJID, jumpWindow, jumpThread]);

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

  // A modal (chat profile, user profile, ...) covers the chat, so the
  // composer's keyboard must not stay open on top of it.
  useEffect(() => {
    if (activeModal) {
      Keyboard.dismiss();
    }
  }, [activeModal]);

  // A host drives the reader's language from OUTSIDE the component through
  // `config.translates.readerLocale` (their own switcher, or the testbed's
  // Setup tab). Nothing was syncing it into `langSource`, so pinning it only
  // redirected the incoming-translation lookup while the UI captions and the
  // `<translate source>` on outgoing messages kept following the unset
  // langSource — which is why picking a language appeared to do nothing.
  //
  // Its own effect, not part of init: it has to re-fire whenever the host
  // changes the value mid-session. And it dispatches only when the value is
  // actually set, so a host that leaves it unset never clobbers what the
  // reader picked from the globe.
  useEffect(() => {
    const resolved = resolveExternalReaderLocaleLangSource(
      config?.translates?.readerLocale
    );
    if (resolved) {
      dispatch(setLangSource(resolved));
    }
  }, [config?.translates?.readerLocale, dispatch]);

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

  // Presentational config flags (e.g. `disableHeader`) can change while the
  // chat stays mounted — sync them to redux whenever `config` actually
  // changes, not just at init. Kept separate from the init effect below so
  // toggling a flag doesn't re-run client/token setup. Guarded with a
  // shallow-equal check (not just the `config` reference) because hosts
  // commonly pass an inline object literal (`<Chat config={{...}}/>`) that
  // is a new reference on every render even when nothing in it changed —
  // dispatching unconditionally there would re-render every config
  // consumer (ChatRoom, modals, ...) on every host render.
  const lastSyncedConfigRef = useRef<IConfig | undefined>(undefined);
  useEffect(() => {
    if (config && !shallowEqual(lastSyncedConfigRef.current, config)) {
      lastSyncedConfigRef.current = config;
      dispatch(setConfig(config));
    }
  }, [config, dispatch]);

  useEffect(() => {
    if (roomJID) {
      dispatch(
        setCurrentRoom({
          roomJID: normalizeRoomJid(roomJID, config?.xmppSettings?.conference),
        }),
      );
    }

    // Top-up rotation after the client is up. Deduped inside
    // `refreshAuthTokensQuietly`, so it can no longer race the 401
    // interceptor into a second, parallel rotation — which the backend
    // would read as reuse. Never rejects, hence no `.catch` here.
    const ensureFreshTokens = () => {
      if (config?.refreshTokens?.enabled) {
        refreshAuthTokensQuietly();
      }
    };

    const initXmmpClient = async () => {
      // Only sync config to redux if we have one — passing `undefined`
      // wipes whatever XmppProvider already set up.
      if (config) {dispatch(setConfig(config));}
      // Seeds only when the host actually set the legacy single-locale
      // field, never on mere `enabled` — see resolveLangSource.
      const legacyLangSource = resolveLegacyTranslatesLangSource(
        config?.translates
      );
      if (legacyLangSource) {
        dispatch(setLangSource(legacyLangSource));
      }
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
          ensureFreshTokens();
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
          ensureFreshTokens();
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
          ensureFreshTokens();
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
  // List mode: the room is pushed over the list and can be swiped back
  // (RoomStack). With `roomJID` / `disableRooms` there is no list to return to.
  const listMode = !config?.disableRooms && !roomJID;

  // The open thread, over the room (a message with `activeMessage` set).
  const threadView = activeMessage ? (
    <ThreadWrapper
      key={activeMessage.id}
      activeMessage={activeMessage}
      user={user}
      customMessageComponent={CustomMessageComponent || Message}
    />
  ) : null;
  const backToList = () => {
    dispatch(setCurrentRoom({ roomJID: '' }));
  };

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
              backgroundColor: theme.surface,
              borderRadius: 12,
              maxWidth: 320,
              alignItems: 'stretch',
            }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                marginBottom: 8,
                color: theme.text,
              }}>
              {sessionLost ? t('session.expiredTitle') : t('connection.errorTitle')}
            </Text>
            <Text
              testID="chat-error-body"
              style={{fontSize: 13, color: theme.textSecondary, marginBottom: 16}}
            >
              {errorMsg ??
                (sessionLost ? t('session.expiredBody') : t('connection.errorBody'))}
            </Text>
            <Pressable
              testID="chat-error-retry"
              onPress={() => {
                setShowModal(false);
                setErrorMsg(null);
                setSessionLost(false);
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
                backgroundColor: pressed ? '#0040A0' : theme.primary,
                alignItems: 'center',
              })}>
              <Text style={{color: theme.textOnPrimary, fontWeight: '600'}}>{t('action.retry')}</Text>
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
              {listMode ? (
                <RoomStack
                  ref={roomStackRef}
                  onBack={backToList}
                  roomBackground={theme.chatBackground}
                  // An open modal covers the room: back must not pull the
                  // room out from under it.
                  hardwareBack={!activeModal}
                  list={
                    <RoomList
                      chats={Object.values(rooms)}
                      onRoomClick={handleChangeChat}
                    />
                  }
                  room={
                    showRoomList ? null : (
                      <ChatWrapperBox
                        style={{
                          ...MainComponentStyles,
                        }}>
                        <ChatRoom
                          CustomMessageComponent={
                            CustomMessageComponent || Message
                          }
                          handleBackClick={popRoom}
                        />
                        {threadView}
                      </ChatWrapperBox>
                    )
                  }
                />
              ) : (
                <ChatWrapperBox
                  style={{
                    ...MainComponentStyles,
                  }}>
                  <ChatRoom
                    CustomMessageComponent={CustomMessageComponent || Message}
                  />
                  {threadView}
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
                title={t('modal.deleteMessage.title')}
                description={t('modal.deleteMessage.description')}
                buttonText={t('action.delete')}
                backgroundColorButton={theme.danger}
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
