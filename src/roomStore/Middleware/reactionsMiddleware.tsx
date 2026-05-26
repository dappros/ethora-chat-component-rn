import { Middleware, PayloadAction } from '@reduxjs/toolkit';
import { updateRoom } from '../roomsSlice';
import { IRoom, ReactionAction } from '../../types/types';
import { nanoToMs } from '../../helpers/nanoToMs';

export const reactionsMiddleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (action.type !== 'roomMessages/setReactions') {
      return next(action);
    }

    if (!action.payload || typeof action.payload !== 'object') {
      console.error('Invalid action payload for setReactions:', action);
      return next(action);
    }

    const result = next(action);
    const state = storeAPI.getState();
    const rooms: { [jid: string]: IRoom } = state.rooms.rooms;
    const { roomJID, reactions, latestReactionTimestamp, data, ...rest } =
      action.payload;

    const updLastMessage = () => {
      if (!reactions?.[0]) {
        const newLastMessage =
          rooms[roomJID].messages[rooms[roomJID].messages.length - 1];

        storeAPI.dispatch(
          updateRoom({
            jid: roomJID,
            updates: {
              lastMessageTimestamp: nanoToMs(
                rooms[roomJID].messages[rooms[roomJID].messages.length - 1].id
              ) ?? 0,
              lastMessage: newLastMessage as any,
            },
          })
        );
      } else {
        const updates = {
          lastMessageTimestamp: nanoToMs(latestReactionTimestamp) ?? 0,
          lastMessage: {
            ...rest,
            body: reactions[0],
            emoji: reactions[0],
            user: {
              name: `${data.senderFirstName} ${data.senderLastName}`,
              id: `emoji-${new Date().toString()}`,
            },
            date: new Date(nanoToMs(latestReactionTimestamp) ?? 0).toISOString(),
          },
        };

        storeAPI.dispatch(
          updateRoom({
            jid: roomJID,
            updates: updates as any,
          })
        );
      }
    };

    if (!rooms[roomJID]) {
      console.warn(`Room ${roomJID} not found in reactions middleware`);
      return result;
    }

    if (
      (rooms[roomJID]?.lastMessageTimestamp ?? 0) <= (nanoToMs(latestReactionTimestamp) ?? 0)
    ) {
      updLastMessage();
    } else if (!rooms[roomJID]?.lastMessageTimestamp) {
      updLastMessage();
    }

    return result;
  };
