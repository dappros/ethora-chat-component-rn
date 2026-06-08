import { useSyncExternalStore } from 'react';
import { IRoom } from '../types/types';
import { store } from '../roomStore';

interface UnreadMessagesMap {
  [roomJid: string]: number;
}

interface UnreadMessagesStats {
  hasUnread: boolean;
  totalCount: number;
  unreadByRoom: UnreadMessagesMap;
  isLoading: boolean;
}

export const useUnreadMessagesCounter = (): UnreadMessagesStats => {
  // Notify React on EVERY store change and let useSyncExternalStore's
  // snapshot comparison (Object.is on the `rooms` reference) decide
  // whether to re-render. The previous implementation only fired the
  // callback while iterating rooms that already had `unreadMessages`
  // defined — so when `rooms` became empty (logout, or the last room
  // removed) the loop body never ran, the callback never fired, and the
  // hook never re-rendered: a consumer's badge stayed stuck at its last
  // non-zero count after logout. (It's also cheaper — one callback per
  // change instead of one per unread room. Redux Toolkit keeps the
  // `rooms` slice reference stable across actions that don't touch it,
  // so non-rooms dispatches still don't trigger a re-render.)
  const subscribe = (callback: () => void) => store.subscribe(callback);

  const roomsState = useSyncExternalStore(
    subscribe,
    () => store.getState().rooms
  );

  const rooms = roomsState.rooms;
  const unreadByRoom: UnreadMessagesMap = {};
  let totalCount = 0;

  Object.entries(rooms).forEach(([roomJid, room]: [string, IRoom]) => {
    const unreadCount = room.unreadMessages || 0;
    if (unreadCount > 0) {
      unreadByRoom[roomJid] = unreadCount;
      totalCount += unreadCount;
    }
  });

  return {
    hasUnread: totalCount > 0,
    totalCount,
    unreadByRoom,
    isLoading: !!roomsState.isUnreadSyncing || !!roomsState.isLoading,
  };
};

export { useUnreadMessagesCounter as useUnread };
