import { useEffect, useRef } from 'react';
import {
  clearJoiningRoom,
  setIsLoading,
  setJoiningRoom,
} from '../roomStore/roomsSlice';
import { useXmppClient } from '../context/xmppProvider';
import { IConfig, IMessage, IRoom } from '../types/types';
import { useDispatch, useSelector, useStore } from 'react-redux';
import useGetNewArchRoom from './useGetNewArchRoom';
import type { RootState } from '../roomStore';

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

const defaultRoomJids = (config: IConfig): string[] =>
  (config?.defaultRooms || []).map((room: any) =>
    typeof room === 'string' ? room : room?.jid
  );

export const useRoomInitialization = (
  activeRoomJID: string,
  config: IConfig
) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();

  const hasRooms = useSelector(
    (state: RootState) => Object.keys(state.rooms.rooms || {}).length > 0
  );
  const activeRoomExists = useSelector(
    (state: RootState) => !!activeRoomJID && !!state.rooms.rooms?.[activeRoomJID]
  );
  const activeHistoryLoaded = useSelector((state: RootState) =>
    hasLoadedRoomHistory(state.rooms.rooms?.[activeRoomJID])
  );
  const defaultRoomsMissing = useSelector((state: RootState) => {
    const jids = defaultRoomJids(config);
    return jids.length > 0 && jids.some((jid) => !state.rooms.rooms?.[jid]);
  });

  const syncRooms = useGetNewArchRoom();

  // Rooms whose join flag this mount already raised. The effect below re-runs
  // as the room list settles; only the first run owns the flag, so a re-run
  // cannot clear it from under a join that is still in flight.
  const joinFlagRef = useRef<Set<string>>(new Set());

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
    const roomsList = reduxStore.getState().rooms.rooms || {};
    const shouldLoadActiveHistory = !!activeRoomJID && !activeHistoryLoaded;

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
        // Entering a room we are not a member of yet (the public chats
        // directory, a link, a QR code). Until it shows up in the room list
        // the pane says "joining" (ChatRoom reads joiningRoomJID) instead of
        // flashing the "choose a chat" placeholder the user just left.
        const joinJid = activeRoomJID;
        const ownsJoinFlag = !joinFlagRef.current.has(joinJid);
        if (ownsJoinFlag) {
          joinFlagRef.current.add(joinJid);
          dispatch(setJoiningRoom(joinJid));
        }
        try {
          await client.presenceInRoomStanza(activeRoomJID);
          if (config?.newArch) {
            await syncRooms(client, config);
          } else {
            await client.getRoomsStanza();
          }
        } finally {
          if (ownsJoinFlag) {
            joinFlagRef.current.delete(joinJid);
            dispatch(clearJoiningRoom(joinJid));
          }
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
      } else if (roomsList?.[activeRoomJID]?.isLoading) {
        dispatch(setIsLoading({ loading: false, chatJID: activeRoomJID }));
      }
    } else if (!roomsList?.[activeRoomJID]) {
      initialPresenceAndHistory();
    }

    if (client && config?.defaultRooms) {
      if (defaultRoomsMissing) {
        config?.defaultRooms.map(async (room) => {
          client.presenceInRoomStanza(typeof room === 'string' ? room : room.jid);
        });
        if (config?.newArch) {
          // syncRooms(client, config);
        } else {
          client.getRoomsStanza();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeRoomJID,
    hasRooms,
    activeRoomExists,
    activeHistoryLoaded,
    defaultRoomsMissing,
  ]);
};
