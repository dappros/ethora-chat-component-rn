import { Middleware } from '@reduxjs/toolkit';
import { updateRoom, msgSortableMs } from '../roomsSlice';
import { IMessage } from '../../types/types';

// Per-room cache so we only recompute when something that affects the
// count actually changed. The fingerprint is `<messages.length>|<lastViewed>`
// — switching just the lastViewedTimestamp (e.g. user re-opens a room)
// must also retrigger, not just the message count.
//
// Kept at module scope so the middleware doesn't re-allocate it on
// every store; cleared on `chat/logout` (see the action gate below) so
// a re-login as a different user doesn't inherit the previous user's
// suppression cache.
let triggerCache: { [jid: string]: string } = {};

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

// Action types that can affect any room's unread count. Without this
// gate the middleware ran on EVERY dispatch — modal toggles, scroll
// events, typing-indicator setComposing, etc. — and walked every room's
// messages array looking for a count delta that almost never came. For
// 50 rooms × 100 messages that's 5000 Date() parses per modal click.
const TRIGGER_ACTIONS = new Set([
  'roomMessages/addRoomMessage',
  'roomMessages/setRoomMessages',
  'roomMessages/editRoomMessage',
  'roomMessages/setLastViewedTimestamp',
  // Hydrating server-side read markers can move several rooms' baselines
  // at once; recompute so the badges reflect the freshly-applied markers
  // (with own-message filtering this middleware adds on top).
  'roomMessages/applyPrivateStoreMarkers',
  'roomMessages/setCurrentRoom',
  'roomMessages/setVisibleRoom',
  'roomMessages/clearVisibleRoom',
  'roomMessages/addRoom',
  'roomMessages/updateRoom',
  // The history preload scheduler merges fetched pages via this action on
  // re-entry; recompute so unread reflects messages that arrived while the
  // app was away (the per-room fingerprint cache below skips no-op batches,
  // e.g. the 'loading' marker dispatch that carries no messages).
  'roomMessages/applyRoomsPreloadBatch',
]);

export const unreadMiddleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (!action || !action.type) {
      console.error('Invalid action in unreadMiddleware:', action);
      return next(action);
    }

    // Reset the per-user suppression cache on logout so the next
    // signed-in user doesn't inherit the previous user's "saw this
    // count, skip" entries.
    if (action.type === 'chat/logout') {
      triggerCache = {};
      return next(action);
    }

    if (action?.type === 'roomMessages/deleteRoomMessage') {
      return next(action);
    }

    const result = next(action);

    // Hot-path bail-out: most actions don't touch unread state.
    if (!TRIGGER_ACTIONS.has(action.type)) {return result;}

    const state = storeAPI.getState();
    const rooms = state.rooms.rooms;
    const visibleRoomJID = state.rooms.visibleRoomJID;
    const selfUser = state.chatSettingStore?.user;
    const selfXmpp = selfUser?.xmppUsername || '';
    const selfWallet = selfUser?.walletAddress || '';

    if (rooms && Object.keys(rooms).length > 0) {
      Object.keys(rooms).forEach((jid) => {
        const room = rooms[jid];
        if (!room) {return;}
        // Skip rooms the user is currently viewing — visibility clears the
        // badge directly. Skip rooms with no reference point (covers
        // undefined / null / 0) — after logout→login, hydrated rooms
        // come back without lastViewedTimestamp, and treating that as 0
        // made every history message satisfy `date > 0` and incorrectly
        // bumped unread for already-seen content.
        if (jid === visibleRoomJID) {
          if (room.unreadMessages !== 0) {
            storeAPI.dispatch(
              updateRoom({
                jid,
                updates: { unreadMessages: 0 },
              })
            );
          }
          return;
        }
        if (!(room.lastViewedTimestamp > 0)) {return;}

        const msgs = room.messages;
        const currentMessagesLength = msgs?.length || 0;
        const firstId = currentMessagesLength ? String(msgs![0]?.id ?? '') : '';
        const lastId = currentMessagesLength
          ? String(msgs![currentMessagesLength - 1]?.id ?? '')
          : '';
        const fingerprint = `${currentMessagesLength}|${room.lastViewedTimestamp || 0}|${firstId}|${lastId}`;
        if (triggerCache[jid] === fingerprint) {return;}
        triggerCache[jid] = fingerprint;

        // Ignore the "delimiter-new" sentinel + locally-pending sends
        // so the two unread-counting paths (this middleware + the
        // reducer's countNewerMessages) never disagree. Also exclude
        // own messages so MAM-replayed sends on re-login don't bump
        // the user's own badge.
        const unreadMessagesCount = room.messages?.filter(
          (msg: IMessage) =>
            msg.id !== 'delimiter-new' &&
            !msg.pending &&
            !isOwnMessage(msg, selfXmpp, selfWallet) &&
            msgSortableMs(msg) >
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
      });
    }

    return result;
  };
