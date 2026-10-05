import { Middleware } from '@reduxjs/toolkit';
import { updateRoom } from '../roomsSlice';
import { IMessage, IRoom } from '../../types/types';

/**
 * Keeps the room-list preview in step with reactions (as on web): the
 * newest event in a room being a reaction shows "Ann: 👍"; a reactor
 * clearing theirs puts the last real message back.
 *
 * Timestamps here are the server's stanza ids, the same unit as
 * `lastMessageTimestamp` (set from message ids in the reducer), so a
 * reaction older than the room's latest message never takes the preview.
 */
export const reactionsMiddleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (action?.type !== 'roomMessages/setReactions') {
      return next(action);
    }
    if (!action.payload || typeof action.payload !== 'object') {
      console.error('Invalid action payload for setReactions:', action);
      return next(action);
    }
    const result = next(action);
    try {
      const payload = action.payload || {};
      const { roomJID, reactions, latestReactionTimestamp, data } = payload;
      const room: IRoom | undefined = storeAPI.getState().rooms?.rooms?.[roomJID];
      if (!room) {return result;}

      const ts = Number(latestReactionTimestamp) || 0;
      const roomTs = Number(room.lastMessageTimestamp) || 0;

      if (Array.isArray(reactions) && reactions[0]) {
        // Only the newest event in the room may become the preview.
        if (!ts || ts < roomTs) {return result;}
        const name = `${data?.senderFirstName || ''} ${data?.senderLastName || ''}`.trim();
        storeAPI.dispatch(
          updateRoom({
            jid: roomJID,
            updates: {
              lastMessageTimestamp: ts,
              lastMessage: {
                id: `reaction-${ts}`,
                body: reactions[0],
                emoji: reactions[0],
                user: { id: `emoji-${ts}`, name },
                date: new Date(Math.floor(ts / 1000)).toISOString(),
              } as any,
            },
          })
        );
        return result;
      }

      // A reaction was cleared: if the preview was a reaction, fall back to
      // the newest real message (the room may have none loaded yet).
      if (!(room.lastMessage as any)?.emoji) {return result;}
      const messages: IMessage[] = room.messages || [];
      let last: IMessage | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.id !== 'delimiter-new' && !m.isDeleted) {
          last = m;
          break;
        }
      }
      storeAPI.dispatch(
        updateRoom({
          jid: roomJID,
          updates: { lastMessage: (last as any) ?? undefined },
        })
      );
    } catch (e) {
      // A preview update must never break the action that carried it.
      console.warn('reactionsMiddleware: preview update failed', e);
    }
    return result;
  };
