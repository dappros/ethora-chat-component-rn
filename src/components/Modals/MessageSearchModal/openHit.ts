import type { AppDispatch } from '../../../roomStore';
import {
  requestJumpToMessage,
  setCurrentRoom,
  setIsLoading,
} from '../../../roomStore/roomsSlice';
import { setActiveModal } from '../../../roomStore/chatSettingsSlice';
import type { MessageSearchHit } from '../../../networking/api-requests/messageSearch.api';

/**
 * The room a hit belongs to, among the rooms this device knows. A hit names
 * its room by full JID and by name (the JID's local part); the archive can
 * hold chats the user has since left, and those have no room to open.
 */
export const resolveHitRoomJid = (
  rooms: Record<string, unknown>,
  hit: Pick<MessageSearchHit, 'room' | 'chatId'>
): string | undefined => {
  if (hit.room && rooms[hit.room]) {return hit.room;}
  return Object.keys(rooms).find((jid) => jid.split('@')[0] === hit.chatId);
};

/**
 * Open a hit: select its room, ask the room's list to land on the message
 * (by id when the archive row has one, else by text and time; see
 * useJumpToMessage), and close the search screen so the message is visible.
 */
export const openSearchHit = (
  dispatch: AppDispatch,
  rooms: Record<string, unknown>,
  activeRoomJID: string | null | undefined,
  hit: MessageSearchHit
): boolean => {
  const roomJID = resolveHitRoomJid(rooms, hit);
  if (!roomJID) {return false;}
  if (roomJID !== activeRoomJID) {
    dispatch(setCurrentRoom({ roomJID }));
    dispatch(setIsLoading({ chatJID: roomJID, loading: true }));
  }
  dispatch(
    requestJumpToMessage({
      roomJID,
      ids: [hit.stanzaId, hit.messageId],
      createdAt: hit.createdAt,
      body: hit.body,
    })
  );
  dispatch(setActiveModal(undefined));
  return true;
};
