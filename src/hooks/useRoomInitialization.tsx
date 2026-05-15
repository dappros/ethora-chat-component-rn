import { useEffect } from 'react';
import { setIsLoading } from '../roomStore/roomsSlice';
import { useXmppClient } from '../context/xmppProvider';
import { IConfig, IMessage, IRoom } from '../types/types';
import { useDispatch } from 'react-redux';
import useGetNewArchRoom from './useGetNewArchRoom';

const countUndefinedText = (arr: IMessage[]) =>
  (Array.isArray(arr) ? arr : []).filter(
    (item) => item?.body === undefined
  )?.length;

const hasLoadedRoomHistory = (room?: IRoom): boolean => {
  const messages = Array.isArray(room?.messages) ? room.messages : [];
  if (!messages.length) {return false;}
  return messages.some(
    (message) =>
      message?.id !== 'delimiter-new' &&
      message?.pending !== true &&
      !!String(message?.body || '').trim()
  );
};

export const useRoomInitialization = (
  activeRoomJID: string,
  roomsList: Record<string, IRoom>,
  config: IConfig,
  messageLength: number
) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  const syncRooms = useGetNewArchRoom();

  // Fast active-room join. Mirrors web's first effect: as soon as the
  // active room changes, eagerly send presence + ask for room info so
  // the header populates and the MUC join lets MAM history flow.
  // Without this, REST-hydrated rooms (which are in `roomsList`
  // without a join) silently return zero messages when getHistoryStanza
  // runs — the user sees an empty chat after tapping a room.
  useEffect(() => {
    if (client && activeRoomJID) {
      client.setActiveRoomJid?.(activeRoomJID);
      client.promoteRoomHistory?.(activeRoomJID);
      try {
        client.presenceInRoomStanza(activeRoomJID);
      } catch {
        /* non-fatal */
      }
      try {
        client.getRoomInfoStanza?.(activeRoomJID);
      } catch {
        /* non-fatal */
      }
    }
    if (client && !activeRoomJID) {
      client.setActiveRoomJid?.(null);
    }
  }, [client, activeRoomJID]);

  useEffect(() => {
    const activeRoom = roomsList?.[activeRoomJID];
    const shouldLoadActiveHistory =
      !!activeRoomJID && !hasLoadedRoomHistory(activeRoom);

    const getDefaultHistory = async () => {
      if (!client || !activeRoomJID) {return;}
      // Re-send presence inside the history fetch as well — joining is
      // idempotent and ensures REST-hydrated rooms have actually joined
      // the MUC before MAM. Web does the same.
      try {
        client.presenceInRoomStanza(activeRoomJID);
      } catch {
        /* non-fatal */
      }
      dispatch(setIsLoading({ loading: true, chatJID: activeRoomJID }));
      try {
        const res = await client.getHistoryStanza(activeRoomJID, 30);
        if (!res?.length) {
          client.prioritizeRoomPresence?.(activeRoomJID).catch(() => {});
        }
        if (res && countUndefinedText(res) > 0) {
          dispatch(setIsLoading({ loading: false, chatJID: activeRoomJID }));
          await client.getHistoryStanza(
            activeRoomJID,
            20 + countUndefinedText(res),
            Number(res[0].id)
          );
        }
      } finally {
        dispatch(
          setIsLoading({
            loading: false,
            chatJID: activeRoomJID,
            loadingText: undefined,
          })
        );
      }
    };

    const initialPresenceAndHistory = async () => {
      if (!roomsList[activeRoomJID] && activeRoomJID && client) {
        await client.presenceInRoomStanza(activeRoomJID);
        if (config?.newArch) {
          await syncRooms(client, config);
        } else {
          await client.getRoomsStanza();
        }
        await getDefaultHistory();
      } else {
        await getDefaultHistory();
      }
    };

    if (Object.keys(roomsList)?.length > 0) {
      if (
        activeRoomJID &&
        !roomsList?.[activeRoomJID] &&
        Object.keys(roomsList).length > 0
      ) {
        dispatch(setIsLoading({ loading: true, chatJID: activeRoomJID }));
        initialPresenceAndHistory();
      } else if (activeRoomJID && shouldLoadActiveHistory) {
        // Was: messageLength<1 && !historyComplete — that gated REST-
        // hydrated rooms out of the history fetch entirely because they
        // have 0 messages but historyComplete is also falsy, so the
        // expression still fires, BUT then getDefaultHistory ran without
        // a presence join. Now we use the same predicate as web (any
        // real, non-pending message in the room counts as "loaded").
        dispatch(setIsLoading({ loading: true, chatJID: activeRoomJID }));
        getDefaultHistory();
      } else {
        dispatch(setIsLoading({ loading: false, chatJID: activeRoomJID }));
      }
    } else if (!roomsList?.[activeRoomJID]) {
      initialPresenceAndHistory();
    }

    if (client && config?.defaultRooms) {
      const allExist = config?.defaultRooms.every(
        (room) => roomsList[room.jid] !== undefined
      );
      if (roomsList && !allExist) {
        config?.defaultRooms.map(async (room) => {
          client.presenceInRoomStanza(room.jid);
        });
        if (config?.newArch) {
          // syncRooms(client, config);
        } else {
          client.getRoomsStanza();
        }
      }
    }
  }, [
    activeRoomJID,
    Object.keys(roomsList).length,
    messageLength,
    roomsList?.[activeRoomJID]?.messages?.length,
  ]);
};
