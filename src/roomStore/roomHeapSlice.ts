import { createSlice, PayloadAction, type Slice } from '@reduxjs/toolkit';
import type { WritableDraft } from 'immer';
import { IMessage } from '../types/types';

// Saved alongside a failed-message id so the retry button can resend
// without the bubble needing to remember the original draft itself.
// `kind === 'text'` carries the plain body; `kind === 'media'` carries
// the upload payload so we don't have to make the user re-pick the file.
export type FailedMessagePayload =
  | {
      kind: 'text';
      id: string;
      roomJID: string;
      body: string;
      isReply?: boolean;
      isChecked?: boolean;
      mainMessage?: string;
    }
  | {
      kind: 'media';
      id: string;
      roomJID: string;
      data: any;
      type: string;
      isReply?: boolean;
      isChecked?: boolean;
      mainMessage?: string;
    };

export interface roomHeapSliceState {
  messageHeap: IMessage[];
  // Keyed by message id so the bubble's `isFailed = failedMessages[id]`
  // check is O(1). Carries enough payload data to actually retry.
  failedMessages: Record<string, FailedMessagePayload>;
}

const initialState: roomHeapSliceState = {
  messageHeap: [],
  failedMessages: {},
};

const reducers = {
  addMessageToHeap: (state: WritableDraft<roomHeapSliceState>, action: PayloadAction<IMessage>) => {
    state.messageHeap.push(action.payload);
  },
  removeMessageFromHeapById: (state: WritableDraft<roomHeapSliceState>, action: PayloadAction<string>) => {
    const index = state.messageHeap.findIndex((m) => m.id === action.payload);
    if (index !== -1) {
      state.messageHeap.splice(index, 1);
    }
  },
  clearHeap: (state: WritableDraft<roomHeapSliceState>) => {
    state.messageHeap = [];
    state.failedMessages = {};
  },
  markMessageFailed: (
    state: WritableDraft<roomHeapSliceState>,
    action: PayloadAction<FailedMessagePayload>
  ) => {
    state.failedMessages[action.payload.id] = action.payload;
    // Drop from the pending heap — the bubble looks at both, and
    // showing "sending..." alongside a failure indicator is confusing.
    const index = state.messageHeap.findIndex((m) => m.id === action.payload.id);
    if (index !== -1) {
      state.messageHeap.splice(index, 1);
    }
  },
  clearMessageFailure: (state: WritableDraft<roomHeapSliceState>, action: PayloadAction<string>) => {
    delete state.failedMessages[action.payload];
  },
};

export const roomHeapSlice: Slice<roomHeapSliceState, typeof reducers, 'roomHeapStore'> = createSlice({
  name: 'roomHeapStore',
  initialState,
  reducers,
});

export const {
  addMessageToHeap,
  clearHeap,
  removeMessageFromHeapById,
  markMessageFailed,
  clearMessageFailure,
} = roomHeapSlice.actions;

export default roomHeapSlice.reducer;
