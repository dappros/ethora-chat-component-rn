import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { EditAction, HistoryPreloadState, IMessage, IRoom } from '../types/types';
import { insertMessageWithDelimiter } from '../helpers/insertMessageWithDelimiter';

export interface RoomPreloadPatch {
  jid: string;
  messages?: IMessage[];
  historyPreloadState?: HistoryPreloadState;
  unreadCapped?: boolean;
  historyComplete?: boolean;
}

interface RoomMessagesState {
  rooms: { [jid: string]: IRoom };
  activeRoomJID: string | null;
  editAction?: EditAction;
  isLoading: boolean;
  pendingNotificationJid?: string | null;
}

const initialState: RoomMessagesState = {
  rooms: {},
  activeRoomJID: null,
  isLoading: false,
  editAction: {
    isEdit: false,
    roomJid: '',
    messageId: '',
    text: '',
  },
  pendingNotificationJid: null,
};

export const roomsStore = createSlice({
  name: 'roomMessages',
  initialState,
  reducers: {
    addRoom(state, action: PayloadAction<{ roomData: IRoom }>) {
      const { roomData } = action.payload;
      state.rooms[roomData.jid] = roomData;
    },
    deleteRoom(state, action: PayloadAction<{ jid: string }>) {
      const { jid } = action.payload;
      if (state.rooms[jid]) {
        delete state.rooms[jid];
      }
    },
    updateRoom(
      state,
      action: PayloadAction<{ jid: string; updates: Partial<IRoom> }>
    ) {
      const { jid, updates } = action.payload;
      const existingRoom = state.rooms[jid];

      if (existingRoom) {
        state.rooms[jid] = {
          ...existingRoom,
          ...updates,
        };
      }
    },
    setRoomMessages(
      state,
      action: PayloadAction<{ roomJID: string; messages: IMessage[] }>
    ) {
      const { roomJID, messages } = action.payload;
      if (state.rooms[roomJID]) {
        state.rooms[roomJID].messages = messages;
      }
    },
    deleteRoomMessage(
      state,
      action: PayloadAction<{ roomJID: string; messageId: string }>
    ) {
      const { roomJID, messageId } = action.payload;
      if (state.rooms[roomJID]) {
        state.rooms[roomJID].messages.map((message) => {
          if (message.id === messageId) {
            message.isDeleted = true;
          }
        });
      }
    },
    setEditAction: (state, action: PayloadAction<EditAction | undefined>) => {
      if (action.payload?.isEdit) {
        state.editAction = action.payload;
      } else {
        state.editAction = {
          isEdit: false,
          roomJid: '',
          messageId: '',
          text: '',
        };
      }
    },
    editRoomMessage(
      state,
      action: PayloadAction<{
        roomJID: string;
        messageId: string;
        text: string;
      }>
    ) {
      const { roomJID, messageId, text } = action.payload;
      if (state.rooms[roomJID]) {
        state.rooms[roomJID].messages.map((message) => {
          if (message.id === messageId) {
            message.body = text;
          }
        });
      }
    },
    addRoomMessage(
      state,
      action: PayloadAction<{
        roomJID: string;
        message: IMessage;
        start?: boolean;
      }>
    ) {
      const { roomJID, message, start } = action.payload;

      // Guard against the "stanza arrived before /chats/my completed"
      // race — without this, the optional-chain `?.messages` falls
      // back to undefined, and the assignment below tries to set
      // `.messages` on undefined → TypeError. Caller can safely
      // ignore the message; the room will get its messages array on
      // `addRoom` when the API response lands.
      if (!state.rooms[roomJID]) {
        return;
      }

      if (!state.rooms[roomJID].messages) {
        state.rooms[roomJID].messages = [];
      }

      const roomMessages = state.rooms[roomJID].messages;

      if (roomMessages.length === 0 || start) {
        roomMessages.unshift(message);
      } else {
        const lastViewedTimestamp = state.rooms[roomJID].lastViewedTimestamp
          ? new Date(state.rooms[roomJID].lastViewedTimestamp)
          : null;

        insertMessageWithDelimiter(roomMessages, message, lastViewedTimestamp);
      }
    },
    deleteAllRooms(state) {
      state.rooms = {};
    },
    setComposing(
      state,
      action: PayloadAction<{
        chatJID: string;
        composing: boolean;
        composingList?: string[];
      }>
    ) {
      const { chatJID, composing, composingList } = action.payload;
      state.rooms[chatJID].composing = composing;
      state.rooms[chatJID].composingList = composingList;
    },
    setIsLoading: (
      state,
      action: PayloadAction<{ chatJID?: string; loading: boolean }>
    ) => {
      const { chatJID, loading } = action.payload;
      if (chatJID && state.rooms?.[chatJID]) {
        state.rooms[chatJID].isLoading = loading;
      }
      state.isLoading = loading;
    },
    setLastViewedTimestamp: (
      state,
      action: PayloadAction<{ chatJID: string; timestamp: number }>
    ) => {
      const { chatJID, timestamp } = action.payload;
      if (state.rooms[chatJID]) {
        state.rooms[chatJID].lastViewedTimestamp = timestamp;
        // timestamp === 0 means "user is currently viewing this room" —
        // unread is cleared. Otherwise count messages received strictly
        // after the last-viewed instant.
        if (!timestamp) {
          state.rooms[chatJID].unreadMessages = 0;
        } else {
          state.rooms[chatJID].unreadMessages = countNewerMessages(
            state.rooms[chatJID].messages,
            timestamp
          );
        }
      }
    },
    setRoomRole: (
      state,
      action: PayloadAction<{ chatJID: string; role: string }>
    ) => {
      const { chatJID, role } = action.payload;
      if (state.rooms[chatJID]) {
        state.rooms[chatJID].role = role;
      }
    },
    setRoomNoMessages: (
      state,
      action: PayloadAction<{ value: boolean; chatJID?: string }>
    ) => {
      const { value, chatJID } = action.payload;
      if (chatJID) {
        state.rooms[chatJID].noMessages = value;
      }
    },
    setCurrentRoom: (
      state,
      action: PayloadAction<{ roomJID: string | null }>
    ) => {
      // Accept null/empty so callers can clear the active room (e.g.
      // back button from chat → return to RoomList). Mirrors web.
      state.activeRoomJID = action.payload.roomJID || '';
    },
    /**
     * Stash a JID that a push notification asked us to open before
     * the rooms list has loaded. The Chat component clears this once
     * the room exists locally and dispatches `setCurrentRoom`.
     */
    setPendingNotificationJid: (
      state,
      action: PayloadAction<string | null>
    ) => {
      state.pendingNotificationJid = action.payload;
    },
    clearPendingNotificationJid: (state) => {
      state.pendingNotificationJid = null;
    },
    /**
     * Stamp a message in `state.rooms[roomJID].messages` with an updated
     * reactions list. The reactionsMiddleware listens for this action to
     * keep `IRoom.lastMessage` / `lastMessageTimestamp` in sync.
     */
    setReactions: (
      state,
      action: PayloadAction<{
        roomJID: string;
        messageId: string;
        from?: string;
        reactions: string[];
        latestReactionTimestamp?: string;
        data?: Record<string, string>;
      }>
    ) => {
      const { roomJID, messageId, reactions } = action.payload;
      const room = state.rooms[roomJID];
      if (!room?.messages) {return;}
      for (const msg of room.messages) {
        if (msg?.id === messageId) {
          (msg as any).reactions = reactions;
          break;
        }
      }
    },
    setLogoutState: (state) => {
      state.rooms = {};
      state.activeRoomJID = null;
      state.isLoading = false;
    },
    setActiveMessage: (
      state,
      action: PayloadAction<{ id: string; chatJID: string }>
    ) => {
      const { id, chatJID } = action.payload;

      state.rooms[chatJID].messages.map((message) => {
        if (message.id === id) {
          message.activeMessage = true;
        } else {
          message.activeMessage = false;
        }
      });
    },
    setCloseActiveMessage: (
      state,
      action: PayloadAction<{ chatJID: string }>
    ) => {
      const { chatJID } = action.payload;

      state.rooms[chatJID].messages.map((message) => {
        message.activeMessage = false;
      });
    },
    /**
     * Batched update used by the history preload scheduler. Each patch is
     * applied to its room: messages REPLACE (when provided), state fields
     * MERGE. Rooms that don't exist yet are ignored.
     */
    applyRoomsPreloadBatch: (
      state,
      action: PayloadAction<{ rooms: RoomPreloadPatch[] }>
    ) => {
      const { rooms } = action.payload;
      for (const patch of rooms) {
        const room = state.rooms[patch.jid];
        if (!room) {continue;}
        if (typeof patch.historyPreloadState !== 'undefined') {
          room.historyPreloadState = patch.historyPreloadState;
        }
        if (typeof patch.unreadCapped !== 'undefined') {
          room.unreadCapped = patch.unreadCapped;
        }
        if (typeof patch.historyComplete !== 'undefined') {
          room.historyComplete = patch.historyComplete;
        }
        if (Array.isArray(patch.messages)) {
          // Merge: keep any locally-pending messages, replace the rest.
          const pending = room.messages?.filter((m) => m?.pending) || [];
          room.messages = [...patch.messages, ...pending];
        }
      }
    },
  },
});

// Count messages strictly newer than the given millisecond timestamp.
// Uses `msg.date` (canonical ISO/Date) so it matches the unread
// middleware. Excludes the "delimiter-new" sentinel and pending sends.
const countNewerMessages = (
  messages: IMessage[],
  timestamp: number
): number => {
  if (!messages?.length || !timestamp) {return 0;}
  let count = 0;
  for (const message of messages) {
    if (!message || message.id === 'delimiter-new' || message.pending) {continue;}
    const ms = new Date(message.date as any).getTime();
    if (Number.isFinite(ms) && ms > timestamp) {count += 1;}
  }
  return count;
};

export const {
  addRoom,
  deleteAllRooms,
  setRoomMessages,
  addRoomMessage,
  deleteRoomMessage,
  setEditAction,
  editRoomMessage,
  setComposing,
  setIsLoading,
  setLastViewedTimestamp,
  setRoomNoMessages,
  setCurrentRoom,
  setRoomRole,
  setLogoutState,
  setActiveMessage,
  setCloseActiveMessage,
  deleteRoom,
  updateRoom,
  applyRoomsPreloadBatch,
  setPendingNotificationJid,
  clearPendingNotificationJid,
  setReactions,
} = roomsStore.actions;

export default roomsStore.reducer;
