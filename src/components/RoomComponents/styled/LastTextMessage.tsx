import React, { FC } from 'react';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
} from './StyledRoomComponents';
import { LastMessage } from '../../../types/types';
import { decodeHTMLEntities } from '../../../helpers/parseMessageBody';

interface LastMessageEmojiProps extends Pick<LastMessage, 'user' | 'body'> {}

const getPlainText = (body: string | undefined): string => {
  if (!body || typeof body !== 'string') {
    return 'Chat created';
  }

  let text = decodeHTMLEntities(body);

  text = text.replace(/^#{1,6}\s+/gm, '');

  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');

  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  text = text.replace(/~~([^~]+)~~/g, '$1');

  text = text.replace(/`([^`]+)`/g, '$1');

  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  text = text.replace(/^[\s]*[-*+]\s+/gm, '');

  text = text.replace(/^\s*\d+\.\s+/gm, '');

  text = text.replace(/\|/g, ' ');

  text = text.replace(/```[\s\S]*?```/g, '');

  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/\s+/g, ' ');

  text = text.replace(/\n/g, ' ').trim();

  return text || 'Chat created';
};

const LastTextMessage: FC<LastMessageEmojiProps> = ({ user, body }) => {
  const plainText = getPlainText(body);

  return (
    <LastRoomMessageContainer>
      <LastRoomMessageName numberOfLines={1} ellipsizeMode="tail">
        {user?.name}
      </LastRoomMessageName>
      <LastRoomMessageText numberOfLines={1} ellipsizeMode="tail">
        {plainText}
      </LastRoomMessageText>
    </LastRoomMessageContainer>
  );
};

export default LastTextMessage;
