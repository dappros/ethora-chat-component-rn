import React from 'react';
import { ScheduleCallSheet } from './ScheduleCallSheet';
import { ScheduledCallPreJoin } from './ScheduledCallPreJoin';

/**
 * Mounts the scheduled-call sheets once, next to the call overlay. They live
 * above the chat (not inside a room) because a link can open the pre-join
 * screen while the user is on a host-app screen or the room list.
 * Both render nothing until the flow opens them.
 */
export const ScheduledCallHost: React.FC = () => (
  <>
    <ScheduleCallSheet />
    <ScheduledCallPreJoin />
  </>
);

export default ScheduledCallHost;
