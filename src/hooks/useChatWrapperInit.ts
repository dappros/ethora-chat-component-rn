/** @format */

import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { IConfig } from '../types/types';
import XmppClient from '../networking/xmppClient';
import { AppDispatch, RootState } from '../roomStore';
import { useXmppClient } from '../context/xmppProvider';
import { chatAutoEnterer } from '../helpers/chatAutoEnterer';
import { initRoomsPresence } from '../helpers/initRoomsPresence';
import { updatedChatLastTimestamps } from '../helpers/updatedChatLastTimestamps';
import { updateMessagesTillLast } from '../helpers/updateMessagesTillLast';
import { refresh } from '../networking/apiClient';
import { setLangSource, setConfig } from '../roomStore/chatSettingsSlice';
import { setIsLoading } from '../roomStore/roomsSlice';
import { useRoomState } from './useRoomState';
import { useChatSettingState } from './useChatSettingState';
import { isChatIdPresentInArray } from '../helpers/isChatIdPresentInArray';
import useGetNewArchRoom from './useGetNewArchRoom';
import { getRoomsWithRetry } from '../helpers/getRoomsWithRetry';

interface useChatWrapperInitProps {
  roomJID: string | null | undefined;
  wasAutoSelected: boolean;
  config: IConfig;
}

interface useChatWrapperInitResult {
  inited: boolean;
  isRetrying: boolean | 'norooms';
  showModal: boolean;
  setInited: React.Dispatch<React.SetStateAction<boolean>>;
  setShowModal: React.Dispatch<React.SetStateAction<boolean>>;
  client: XmppClient | null;
  setClient: React.Dispatch<React.SetStateAction<XmppClient | null>>;
  isConnectionLost: boolean;
}

const useChatWrapperInit = ({
  roomJID,
  wasAutoSelected,
  config,
}: useChatWrapperInitProps): useChatWrapperInitResult => {
  const dispatch = useDispatch<AppDispatch>();
  const [inited, setInited] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isConnectionLost, setConnectionLost] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean | 'norooms'>(false);
  const hasSyncedHistoryRef = useRef<boolean>(false);

  const { client, initializeClient, setClient } = useXmppClient();
  const syncRooms = useGetNewArchRoom();

  const { rooms } = useSelector((state: RootState) => state.rooms);
  const { roomsList } = useRoomState();
  const { user } = useChatSettingState();

  useEffect(() => {
    return () => {
      if (client && user.xmppPassword === '') {
        console.log('closing client');
        client.close();
        setClient(null);
      }
    };
  }, [user.xmppPassword]);

  const getRoomsWithRertyRequest = async () => {
    setIsRetrying(true);
    const retryRooms = await getRoomsWithRetry(
      client,
      config,
      syncRooms,
      roomJID
    );
    if (!retryRooms) {
      setIsRetrying('norooms');
      return;
    }
    setIsRetrying(false);
  };

  const loadRooms = async (
    client: XmppClient,
    disableLoad: boolean = false
  ) => {
    !disableLoad &&
      dispatch(
        setIsLoading({ loading: true, loadingText: 'Loading rooms...' })
      );
    const rooms = await syncRooms(client, config);
    dispatch(setIsLoading({ loading: false, loadingText: undefined }));
    return rooms;
  };

  useEffect(() => {
    let retryTimeout: NodeJS.Timeout;

    const initXmmpClient = async () => {
      if (config?.translates?.enabled && !config?.translates?.translations) {
        dispatch(setLangSource(config?.translates?.translations));
      }

      dispatch(setConfig(config));
      try {
        if (!user.xmppUsername) {
          setShowModal(true);
          console.error('Error, no user');
        } else {
          chatAutoEnterer({ roomJID, wasAutoSelected, config, dispatch });

          if (!client) {
            try {
              setInited(false);
              setShowModal(false);

              console.log(' No client, initializing one');
              const newClient = await initializeClient(
                user.xmppUsername || user?.defaultWallet?.walletAddress,
                user?.xmppPassword,
                config?.xmppSettings
              ).then((client) => {
                console.log(' Client initialized', client?.status);
                return client;
              });

              if (roomsList && Object.keys(roomsList).length > 0) {
                console.log(
                  ' Using existing roomsList',
                  Object.keys(roomsList).length
                );
                setInited(true);
                await initRoomsPresence(newClient, roomsList);
              } else {
                if (config?.newArch) {
                  console.log(' Loading rooms with newArch');
                  const loadedRooms = await loadRooms(newClient);
                  console.log(' Loaded rooms', loadedRooms?.length || 0);
                  if (config?.enableRoomsRetry?.enabled) {
                    const isSelectedRoomPresent = isChatIdPresentInArray(
                      roomJID,
                      loadedRooms
                    );
                    console.log(
                      ' Selected room present?',
                      isSelectedRoomPresent,
                      roomJID
                    );
                    if (!isSelectedRoomPresent) {
                      await getRoomsWithRertyRequest();
                    }
                  }
                  setInited(true);
                } else {
                  console.log(' Using old arch, getting rooms stanza');
                  await newClient.getRoomsStanza();
                }
              }
              await newClient
                .getChatsPrivateStoreRequestStanza()
                .then(
                  async (
                    roomTimestampObject: any
                  ) => {
                    console.log(
                      'Got chats private store',
                      roomTimestampObject?.length || 0
                    );
                    updatedChatLastTimestamps(roomTimestampObject, dispatch);
                    if (!hasSyncedHistoryRef.current) {
                      console.log('Updating messages till last');
                      await updateMessagesTillLast(rooms, newClient);
                      hasSyncedHistoryRef.current = true;
                    }
                    setClient(newClient);
                    setConnectionLost(false);
                    console.log('Initialization complete');
                  }
                );

              {
                config?.refreshTokens?.enabled && refresh();
              }
            } catch (error) {
              console.error(' Error during initialization', error);
              setConnectionLost(true);
              retryTimeout = setTimeout(initXmmpClient, 5000);
            }
          } else {
            if (config?.newArch) {
              if (config?.enableRoomsRetry?.enabled) {
                const isSelectedRoomPresent = isChatIdPresentInArray(
                  roomJID,
                  roomsList
                );
                console.log(
                  'Selected room present in existing client?',
                  isSelectedRoomPresent
                );
                if (!isSelectedRoomPresent) {
                  await getRoomsWithRertyRequest();
                }
              }
            }
            setInited(true);
            console.log(' Getting chats private store for existing client');
            await client
              .getChatsPrivateStoreRequestStanza()
              .then(
                async (
                  roomTimestampObject: any
                ) => {
                  console.log(
                    'Got chats private store for existing client',
                    roomTimestampObject?.length || 0
                  );
                  updatedChatLastTimestamps(roomTimestampObject, dispatch);
                  if (!hasSyncedHistoryRef.current) {
                    console.log(
                      'Updating messages till last for existing client'
                    );
                    await updateMessagesTillLast(rooms, client);
                    hasSyncedHistoryRef.current = true;
                  }
                  setClient(client);
                  setConnectionLost(false);
                  console.log(' Initialization complete for existing client');
                }
              );
            {
              config?.refreshTokens?.enabled && refresh();
            }
          }
        }
        dispatch(setIsLoading({ loading: false }));
      } catch (error) {
        console.error(' Fatal error', error);
        setShowModal(false);
        setConnectionLost(true);
        setInited(false);
        dispatch(setIsLoading({ loading: false }));
        retryTimeout = setTimeout(initXmmpClient, 5000);
      }
    };

    initXmmpClient();

    return () => {
      clearTimeout(retryTimeout);
    };
  }, [user.xmppPassword, user.xmppUsername]);

  return {
    client,
    inited,
    isRetrying,
    showModal,
    isConnectionLost,
    setClient: setClient as any,
    setInited,
    setShowModal,
  };
};

export default useChatWrapperInit;
