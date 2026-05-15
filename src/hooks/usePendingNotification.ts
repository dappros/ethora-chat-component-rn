import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootState } from '../roomStore';
import { setCurrentRoom, clearPendingNotificationJid } from '../roomStore/roomsSlice';

const PENDING_NOTIFICATION_JID_KEY = 'ethora_pending_notification_jid';

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
        try {
          const storedJid = await AsyncStorage.getItem(PENDING_NOTIFICATION_JID_KEY);
          if (storedJid) {
            jidToOpen = storedJid;
            await AsyncStorage.removeItem(PENDING_NOTIFICATION_JID_KEY);
          }
        } catch (error) {
          console.error('Error reading from AsyncStorage:', error);
        }
      }

      if (jidToOpen) {
        const room = rooms[jidToOpen];
        if (room) {
          return;
        }
      }
    };

    checkPendingNotification();
  }, [rooms, pendingNotificationJid, isLoading, dispatch]);

  return { pendingNotificationJid };
}

export default usePendingNotification;
