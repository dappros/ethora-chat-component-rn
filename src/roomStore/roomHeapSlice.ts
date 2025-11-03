import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { IMessage } from '../types/types';

interface roomHeapSliceState {
  messageHeap: IMessage[];
}

const initialState: roomHeapSliceState = {
  messageHeap: [],
};

export const roomHeapSlice = createSlice({
  name: 'roomHeapStore',
  initialState,
  reducers: {
    addMessageToHeap: (state, action: PayloadAction<IMessage>) => {
      state.messageHeap.push(action.payload);
    },
    popMessageFromHeap: (state) => {
      if (state.messageHeap.length > 0) {
        state.messageHeap.shift();
      }
    },
    removeMessageFromHeapById: (state, action: PayloadAction<string>) => {
      const index = state.messageHeap.findIndex((m) => m.id === action.payload);
      if (index !== -1) {
        state.messageHeap.splice(index, 1);
      }
    },
    clearHeap: (state) => {
      state.messageHeap = [];
    },
  },
});

export const {
  addMessageToHeap,
  popMessageFromHeap,
  clearHeap,
  removeMessageFromHeapById,
} = roomHeapSlice.actions;

export default roomHeapSlice.reducer;
