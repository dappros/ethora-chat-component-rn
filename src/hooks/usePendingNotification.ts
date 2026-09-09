import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootState } from '../roomStore';
import { setCurrentRoom, clearPendingNotificationJid } from '../roomStore/roomsSlice';

import { PENDING_NOTIFICATION_JID_KEY, readPendingJid } from '../helpers/pushPayload';

export function usePendingNotification() {
  const dispatch = useDispatch();
  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const pendingNotificationJid = useSelector(
    (state: RootState) => state.rooms.pendingNotificationJid
  );
  const isLoading = useSelector((state: RootState) => state.rooms.isLoading);

  useEffect(() => {
    const checkPendingNotification = async () => {
      if (isLoading) {return;}

      let jidToOpen = pendingNotificationJid;

      if (!jidToOpen) {
        jidToOpen = await readPendingJid();
      }

      if (jidToOpen) {
        const room = rooms[jidToOpen];
        if (room) {
          dispatch(clearPendingNotificationJid());
          AsyncStorage.removeItem(PENDING_NOTIFICATION_JID_KEY).catch(() => undefined);
          dispatch(setCurrentRoom({ roomJID: jidToOpen }));
        }
      }
    };

    checkPendingNotification();
  }, [rooms, pendingNotificationJid, isLoading, dispatch]);

  return { pendingNotificationJid };
}

export default usePendingNotification;
