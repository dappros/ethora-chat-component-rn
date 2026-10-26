import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import type { RootState } from '../../roomStore';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useT } from '../../i18n/useT';
import { getIconColor } from '../../helpers/getIconColor';
import { scheduledCallUi } from '../../booking/scheduledCallStore';
import { ScheduleCallIcon } from './BookingIcons';

/**
 * "Schedule a call" next to the call buttons of the room header. Renders
 * nothing unless calls are on and calls are allowed in this kind of room
 * (`videoCalls.allowedRoomTypes`, private and group by default) and `scheduledCalls.enabled`
 * is not false, so a host that does
 * not use calls sees no change.
 */
export const ScheduleCallButton: React.FC = () => {
  const t = useT();
  const { config } = useChatSettingState();
  const room = useSelector((state: RootState) => {
    const jid = state.rooms.activeRoomJID;
    return jid ? state.rooms.rooms[jid] : null;
  });

  const calls = config?.videoCalls;
  // 1:1 and members-only group rooms by default (the room types a call can run
  // in), narrowed or widened by the host's videoCalls.allowedRoomTypes.
  const allowed = ((calls?.allowedRoomTypes as string[] | undefined) || [
    'private',
    'group',
  ]).includes(String(room?.type || ''));
  if (
    calls?.enabled !== true ||
    config?.scheduledCalls?.enabled === false ||
    !room?.jid ||
    !allowed
  ) {
    return null;
  }

  return (
    <TouchableOpacity
      testID="schedule-call-button"
      accessibilityRole="button"
      accessibilityLabel={t('booking.scheduleCallLabel')}
      onPress={() => scheduledCallUi.openCreate(room.jid)}
      style={styles.button}
      hitSlop={8}
    >
      <ScheduleCallIcon color={getIconColor(config)} size={22} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ScheduleCallButton;
