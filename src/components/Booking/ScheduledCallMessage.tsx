import React, { Fragment } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../roomStore';
import type { IConfig, IMessage } from '../../types/types';
import DateLabel from '../styled/DateLabel';
import {
  latestScheduledCallMessage,
  parseScheduledCallMessage,
} from '../../booking/scheduledCall';
import ScheduledCallCard from './ScheduledCallCard';

interface ScheduledCallMessageProps {
  message: IMessage;
  config?: IConfig;
  showDateLabel: boolean;
  CustomDaySeparator?: React.ComponentType<{
    date: Date;
    formattedDate: string;
  }>;
}

/**
 * One card per slug: only the room's newest message for a slug draws it (with
 * that message's status); every older message of the same slug draws nothing.
 * A message that is not a usable invite falls back to nothing too, its body
 * text is the plain "Scheduled call: ..." line old clients show.
 */
export const ScheduledCallMessage: React.FC<ScheduledCallMessageProps> = ({
  message,
  config,
  showDateLabel,
  CustomDaySeparator,
}) => {
  const roomJid = message.roomJid;
  const slug = String((message as any).scheduledCallSlug || '');
  const latest = useSelector((state: RootState) =>
    latestScheduledCallMessage(state.rooms.rooms[roomJid]?.messages, slug)
  );
  // Not in the room list (a jump window, a thread): this message stands alone.
  const owner = latest || message;
  if (owner.id !== message.id) {return null;}
  const card = parseScheduledCallMessage(owner);
  if (!card) {return null;}

  const date = new Date(message.date);
  return (
    <Fragment>
      {showDateLabel &&
        (CustomDaySeparator ? (
          <CustomDaySeparator
            date={date}
            formattedDate={date.toLocaleDateString()}
          />
        ) : (
          <DateLabel date={date} colors={config?.colors} />
        ))}
      <ScheduledCallCard card={card} roomJid={roomJid} />
    </Fragment>
  );
};

export default ScheduledCallMessage;
