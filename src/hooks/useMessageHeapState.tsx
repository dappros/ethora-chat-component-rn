import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../roomStore';

export const useMessageHeapState = () => {
  const queue = useSelector(
    (state: RootState) => state.roomHeapSlice?.messageHeap
  );
  const failedMessages = useSelector(
    (state: RootState) => state.roomHeapSlice?.failedMessages
  );
  const idSet = useMemo(() => new Set(queue?.map((m) => m.id) ?? []), [queue]);
  const failedIdSet = useMemo(
    () => new Set(Object.keys(failedMessages || {})),
    [failedMessages]
  );

  return { queue, idSet, failedMessages, failedIdSet };
};
