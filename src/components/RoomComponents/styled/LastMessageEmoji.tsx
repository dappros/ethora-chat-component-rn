import React, { FC } from 'react';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
} from './StyledRoomComponents';
import { LastMessage } from '../../../types/types';
import { getEmojiNativeById } from '../../../helpers/emoji';

interface LastMessageEmojiProps extends Pick<LastMessage, 'user' | 'emoji'> {}

/**
 * The room-list preview when the latest event in a room is a reaction.
 * The stanza carries the emoji's short name (`joy`, `+1`), as on web — it
 * is resolved to the glyph here; a glyph or unknown id renders as is.
 */
const LastMessageEmoji: FC<LastMessageEmojiProps> = ({ user, emoji }) => {
  const name = (user?.name || '').trim();
  return (
    <LastRoomMessageContainer>
      {!!name && <LastRoomMessageName>{name}:</LastRoomMessageName>}
      <LastRoomMessageText>{emoji ? getEmojiNativeById(emoji) : ''}</LastRoomMessageText>
    </LastRoomMessageContainer>
  );
};

export default LastMessageEmoji;
