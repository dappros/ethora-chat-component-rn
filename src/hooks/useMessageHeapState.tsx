import { useSelector } from 'react-redux';
import { RootState } from '../roomStore';

export const useMessageHeapState = () => {
  const queue = useSelector(
    (state: RootState) => state.roomHeapSlice?.messageHeap
  );
  const failedMessages = useSelector(
    (state: RootState) => state.roomHeapSlice?.failedMessages
  );
  const idSet = new Set(queue?.map((m) => m.id) ?? []);
  const failedIdSet = new Set(Object.keys(failedMessages || {}));

  return { queue, idSet, failedMessages, failedIdSet };
};
