import { useCallback } from 'react';
import { useAppDispatch } from './hooks';
import { useXmppClient } from '../context/xmppProvider';
import { createRoomFromApi } from '../helpers/createRoomFromApi';
import { getRooms } from '../networking/api-requests/rooms.api';
import {
  addRoomViaApi,
  setIsLoading,
  updateUsersSet,
} from '../roomStore/roomsSlice';
import { ApiRoom } from '../types/types';
import { pushSubscriptionService } from '../services/pushSubscriptionService';

const useGetNewArchRoom = () => {
  const { client } = useXmppClient();
  const dispatch = useAppDispatch();

  const syncRooms = useCallback(
    async (client: any, config: any): Promise<ApiRoom[]> => {
      const rooms = await getRooms();
      const roomJIDs: string[] = [];

      rooms?.items?.forEach((room) => {
        const createdRoom = createRoomFromApi(room, config?.xmppSettings?.conference);
        if (createdRoom) {
          dispatch(
            addRoomViaApi({
              room: createdRoom,
              xmpp: client,
            })
          );
          if (createdRoom.jid) {
            roomJIDs.push(createdRoom.jid);
          }
        }
      });
      dispatch(setIsLoading({ loading: false, loadingText: undefined }));
      dispatch(updateUsersSet({ rooms: rooms.items || [] }));

      if (client?.client && roomJIDs.length > 0) {
        const userNick = client.client.jid?.getLocal();
        await pushSubscriptionService
          .subscribeToRooms(client.client, roomJIDs, userNick)
          .catch((error) => {
            console.error('Failed to subscribe to loaded rooms for push:', error);
          });
      }

      return rooms?.items || [];
    },
    [dispatch]
  );

  return syncRooms;
};

export default useGetNewArchRoom;
