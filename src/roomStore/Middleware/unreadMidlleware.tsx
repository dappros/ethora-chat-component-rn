import { Middleware } from '@reduxjs/toolkit';
import { updateRoom } from '../roomsSlice';
import { IMessage } from '../../types/types';

let previousMessagesCount: { [jid: string]: number } = {};

// Normalise an identity candidate (bare JID local, xmpp username, wallet)
// for case-insensitive comparison. Drops the domain part of any JID and
// strips XMPP resource separators ('/' for resource, '_' that the server
// inserts inside the local part for some prefix formats).
const norm = (s: any): string => {
  if (s == null) {return '';}
  let v = String(s).toLowerCase();
  v = v.split('/')[0]; // strip XMPP resource
  v = v.split('@')[0]; // strip JID domain
  return v.replace(/_/g, '');
};

// Mirrors Android `isOwnMessage` (chat-core RoomStore.kt). The sender id
// arrives in either `user.id` (Ethora user id from optimistic local sends)
// or `user.userJID` / `xmppFrom` (XMPP local for server echoes), so we
// match across all three against the current user's candidates.
// Uses exact-match on the normalised bare-local (no substring containment)
// to avoid false positives like norm('someone')='someone' matching
// norm('me')='me' via 'someone'.includes('me').
const isOwnMessage = (
  msg: IMessage,
  selfXmpp: string,
  selfWallet: string
): boolean => {
  if (!selfXmpp && !selfWallet) {return false;}
  const candidates = [
    norm((msg as any)?.user?.id),
    norm((msg as any)?.user?.userJID),
    norm((msg as any)?.user?.xmppUsername),
    norm((msg as any)?.xmppFrom),
  ].filter(Boolean);
  if (candidates.length === 0) {return false;}
  const self = new Set(
    [norm(selfXmpp), norm(selfWallet)].filter(Boolean)
  );
  for (const c of candidates) {
    if (self.has(c)) {return true;}
  }
  return false;
};

export const unreadMiddleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (!action || !action.type) {
      console.error('Invalid action in unreadMiddleware:', action);
      return next(action);
    }

    if (action?.type === 'roomMessages/deleteRoomMessage') {
      return next(action);
    }

    const result = next(action);

    const state = storeAPI.getState();
    const rooms = state.rooms.rooms;
    const activeChatJID = state.rooms.activeRoomJID;
    const selfUser = state.chatSettingStore?.user;
    const selfXmpp = selfUser?.xmppUsername || '';
    const selfWallet = selfUser?.walletAddress || '';

    if (rooms && Object.keys(rooms).length > 0) {
      Object.keys(rooms).forEach((jid) => {
        const room = rooms[jid];
        if (room.lastViewedTimestamp !== 0 && jid !== activeChatJID) {
          const currentMessagesLength = room.messages?.length || 0;

          if (previousMessagesCount[jid] !== currentMessagesLength) {
            previousMessagesCount[jid] = currentMessagesLength;

            // Mirror `countNewerMessages` in roomsSlice: ignore the
            // "delimiter-new" sentinel + locally-pending sends so the
            // two paths never disagree. Additionally exclude own
            // messages (parity with Android `isOwnMessage` + web's
            // `$c(user.id) === $c(currentUserKey)` filter) so the
            // user's own send never bumps their own badge.
            const unreadMessagesCount = room.messages?.filter(
              (msg: IMessage) =>
                msg.id !== 'delimiter-new' &&
                !msg.pending &&
                !isOwnMessage(msg, selfXmpp, selfWallet) &&
                new Date(msg.date).getTime() >
                  (room.lastViewedTimestamp || 0)
            ).length;

            if (room.unreadMessages !== unreadMessagesCount) {
              storeAPI.dispatch(
                updateRoom({
                  jid,
                  updates: { unreadMessages: unreadMessagesCount },
                })
              );
            }
          }
        }
      });
    }

    return result;
  };
