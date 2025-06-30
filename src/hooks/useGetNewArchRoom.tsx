import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { createRoomFromApi } from '../helpers/createRoomFromApi';
import { getRooms } from '../networking/api-requests/rooms.api';
import {
  addRoomViaApi,
  setIsLoading,
  updateUsersSet,
} from '../roomStore/roomsSlice';
import { ApiRoom } from '../types/types';

const useGetNewArchRoom = () => {
  const dispatch = useDispatch();
      console.log('useGetNewArchRoom initialized 1');
  
  const syncRooms = useCallback(
    async (client: any, config: any): Promise<ApiRoom[]> => {
      console.log('useGetNewArchRoom initialized 2');
      const rooms = await getRooms();

      if (!rooms || !Array.isArray(rooms.items)) {
        console.warn('rooms.items is undefined or not an array:', rooms);
        return [];
      }

      rooms?.items?.forEach((room) => {
        dispatch(
          addRoomViaApi({
            room: createRoomFromApi(room, config?.xmppSettings?.conference),
            xmpp: client,
          })
        );
      });
      dispatch(setIsLoading({ loading: false, loadingText: undefined }));
      dispatch(updateUsersSet({ rooms: rooms.items }));
      return rooms?.items || [];
    },
    [dispatch]
  );

  return syncRooms;
};

export default useGetNewArchRoom;
