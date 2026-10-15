import { createSlice, PayloadAction, type Slice } from '@reduxjs/toolkit';
import type { WritableDraft } from 'immer';
import { IMentionSpan, IMessage } from '../types/types';

// Saved alongside a failed-message id so the retry button can resend
// without the bubble needing to remember the original draft itself.
// `kind === 'text'` carries the plain body; `kind === 'media'` carries
// the upload payload so we don't have to make the user re-pick the file.
/**
 * One file of a failed media send, as the retry replays it. Only the fields
 * an upload needs, so it persists as a plain JSON object.
 */
export interface FailedMediaFile {
  uri?: string;
  type?: string;
  name?: string;
  size?: number;
  duration?: number;
  waveForm?: string;
}

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
      /** The first file (or the only one); kept for single-file readers. */
      data: any;
      type: string;
      isReply?: boolean;
      isChecked?: boolean;
      mainMessage?: string;
      /**
       * Every file of the message, in selection order. Retry replays the
       * whole list; a message with no list falls back to `data`.
       */
      files?: FailedMediaFile[];
      /** The caption the files were sent with, if any. */
      caption?: string;
      captionMentions?: IMentionSpan[];
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
