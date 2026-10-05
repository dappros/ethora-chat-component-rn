import { Middleware } from '@reduxjs/toolkit';
import { clearMessageFailure } from '../roomHeapSlice';
import { removeOutboundSend } from '../../networking/outboundQueue';
import { IMessage } from '../../types/types';

export const newMessageMidlleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (!action || !action.type) {
      console.error('Invalid action in newMessageMiddleware:', action);
      return next(action);
    }

    const isSingle = action.type === 'roomMessages/addRoomMessage';
    const isBatch = action.type === 'roomMessages/addRoomMessages';
    if (!isSingle && !isBatch) {
      return next(action);
    }

    if (!action.payload || typeof action.payload !== 'object') {
      console.error('Invalid action payload for addRoomMessage:', action);
      return next(action);
    }

    const result = next(action);
    const state = storeAPI.getState();

    // `lastMessageTimestamp` is now bumped inside the reducer itself (no
    // second `updateRoom` pass per message). What is left here are the
    // side effects outside the rooms slice.
    const messages: IMessage[] = isBatch
      ? action.payload.messages || []
      : [action.payload.message];
    const failedMap = state.roomHeapSlice?.failedMessages || {};

    for (const message of messages) {
      // Un-fail on confirmed delivery. A server-confirmed copy (echo or MAM
      // history, never `pending`) arriving for a message we'd flagged failed
      // means the send actually went through — e.g. a slow send that completed
      // just after the 5s watchdog window, or a queued auto-resend landing on
      // reconnect. The failed flag is keyed by our optimistic/stanza id, which
      // the echo carries back as `id`/`xmppId`, so clear it here and let the
      // bubble flip to delivered instead of staying stuck on "Failed".
      if (message && !message.pending) {
        // The confirmed copy carries our optimistic/stanza id back as id/xmppId.
        // Drop any still-buffered replay for it so a later reconnect flush can't
        // re-send an already-delivered message.
        removeOutboundSend(message.id);
        if (message.xmppId) {removeOutboundSend(message.xmppId);}

        const failedKey = [message.id, message.xmppId].find(
          (k: string | undefined) => k && failedMap[k]
        );
        if (failedKey) {
          storeAPI.dispatch(clearMessageFailure(failedKey as string));
        }
      }
    }

    return result;
  };

//   import { Middleware, PayloadAction } from '@reduxjs/toolkit';
// // import { AddRoomMessageAction, IRoom } from '../../types/types';
// import { nanoToMs } from '../../helpers/nanoToMs';

// export const newMessageMidlleware: Middleware =
//   (storeAPI) =>
//   (next) =>
//   (action: PayloadAction<Partial<AddRoomMessageAction>>) => {
//     if (action.type !== 'roomMessages/addRoomMessage') {
//       return next(action);
//     }

//     const result = next(action);
//     const state = storeAPI.getState();
//     const rooms: { [jid: string]: IRoom } = state.rooms.rooms;
//     const { roomJID, message } = action.payload;

//     const updLastMessage = () => {
//       const updates = {
//         lastMessageTimestamp: nanoToMs(message.id) ?? 0,
//         lastMessage: { ...message },
//       };

//       storeAPI.dispatch(
//         updateRoom({
//           jid: roomJID,
//           updates,
//         })
//       );
//     };

//     if (!message.body) {
//       return result;
//     }

//     try {
//       if (
//         rooms[roomJID]?.lastMessageTimestamp <= nanoToMs(message.id) ||
//         !rooms[roomJID]?.lastMessageTimestamp
//       ) {
//         updLastMessage();
//       }
//     } catch (error) {
//       console.error('Error updating room last message:', error);
//     }

//     return result;
//   };
