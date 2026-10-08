import { useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import type { RootState } from '../roomStore';
import { updateRoom } from '../roomStore/roomsSlice';
import { setRoomMuted } from '../networking/api-requests/rooms.api';

/** Rooms with a mute request in flight: a second tap waits for the first. */
const inFlight = new Set<string>();

/**
 * Mute / unmute a chat's notifications, shared by the chat profile and the
 * room-list swipe. Optimistic: the bell flips at once, the server's answer
 * wins, and a failure flips it back. Resolves false on that failure, so the
 * caller can say so in its own way (the profile toasts, the list alerts).
 */
export const useRoomMute = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  return useCallback(
    async (jid: string): Promise<boolean> => {
      const room = store.getState().rooms.rooms[jid];
      if (!room?.jid || !room?.name || inFlight.has(jid)) {return true;}
      const next = !room.muted;
      inFlight.add(jid);
      dispatch(updateRoom({ jid, updates: { muted: next } }));
      try {
        const confirmed = await setRoomMuted(room.name, next);
        if (confirmed !== next) {
          dispatch(updateRoom({ jid, updates: { muted: confirmed } }));
        }
      } catch (error) {
        dispatch(updateRoom({ jid, updates: { muted: !next } }));
        console.warn('[ethora-rn] mute toggle failed', error);
        return false;
      } finally {
        inFlight.delete(jid);
      }
      return true;
    },
    [dispatch, store]
  );
};
