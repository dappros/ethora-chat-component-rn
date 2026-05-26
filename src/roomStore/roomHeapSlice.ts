import { createSlice, PayloadAction, type Slice } from '@reduxjs/toolkit';
import type { WritableDraft } from 'immer';
import { IMessage } from '../types/types';

export interface roomHeapSliceState {
  messageHeap: IMessage[];
}

const initialState: roomHeapSliceState = {
  messageHeap: [],
};

// Reducers extracted as a named const so we can give the slice an
// explicit Slice<State, typeof reducers, Name> type. Without that, tsc's
// declaration emission inlines immer's internal WritableNonArrayDraft
// type and fails with TS4023.
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
} = roomHeapSlice.actions;

export default roomHeapSlice.reducer;
