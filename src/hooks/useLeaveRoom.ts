import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { deleteRoom } from '../roomStore/roomsSlice';
import { leaveRoom } from '../networking/api-requests/rooms.api';
import { useXmppClient } from '../context/xmppProvider';

/** Rooms with a leave request in flight: a second tap waits for the first. */
const inFlight = new Set<string>();

/**
 * Leave a chat, shared by the room-list swipe, the chat header and the chat
 * profile. The server goes first: if it refuses, the chat stays where it is
 * (dropping it locally would only have it come back on the next /chats/my).
 * Then the unavailable presence to the MUC and the room out of the store.
 * Resolves false on failure, so the caller can say so in its own way.
 */
export const useLeaveRoom = () => {
  const dispatch = useDispatch();
  const { client } = useXmppClient();
  return useCallback(
    async (jid: string): Promise<boolean> => {
      if (!jid || inFlight.has(jid)) {return true;}
      inFlight.add(jid);
      try {
        await leaveRoom(jid.split('@')[0]);
      } catch (error) {
        console.warn('[ethora-rn] leave failed', error);
        return false;
      } finally {
        inFlight.delete(jid);
      }
      try {
        client?.leaveTheRoomStanza?.(jid);
      } catch (error) {
        console.error('Failed to leave the room:', error);
      }
      dispatch(deleteRoom({ jid }));
      return true;
    },
    [client, dispatch]
  );
};
