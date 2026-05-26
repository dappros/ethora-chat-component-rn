import React, { FC } from 'react';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
} from './StyledRoomComponents';
import { LastMessage } from '../../../types/types';

interface LastMessageEmojiProps extends Pick<LastMessage, 'user' | 'emoji'> {}

/**
 * Renders the per-room last-message preview when the latest message
 * is a reaction (emoji). The `emoji` field is expected to already be
 * a unicode glyph (the reaction stanza carries the rendered character,
 * not an `:id:`) so we just render it as-is — no emoji-id resolution
 * library needed. If a legacy payload still ships an `:id:`, it
 * renders verbatim instead of crashing.
 */
const LastMessageEmoji: FC<LastMessageEmojiProps> = ({ user, emoji }) => {
  return (
    <LastRoomMessageContainer>
      <LastRoomMessageName>{user?.name || ''}:</LastRoomMessageName>
      <LastRoomMessageText>{emoji || ''}</LastRoomMessageText>
    </LastRoomMessageContainer>
  );
};

export default LastMessageEmoji;
