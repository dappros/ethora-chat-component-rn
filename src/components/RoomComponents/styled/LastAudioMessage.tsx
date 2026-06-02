import React, { FC } from 'react';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
} from './StyledRoomComponents';
import { LastMessage } from '../../../types/types';
import styled from 'styled-components/native';
import { View } from 'react-native';
import { PlayIcon } from '../../../assets/icons';

interface LastMessageEmojiProps extends Pick<LastMessage, 'user' | 'body'> {}

const PlayButton = styled.View`
  width: 20px;
  height: 20px;
  border-radius: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #d8ecff;
  margin-top: 1px;
`;

const AudioRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
`;

const LastAudioMessage: FC<LastMessageEmojiProps> = ({ user, body }) => {
  return (
    <LastRoomMessageContainer>
      <LastRoomMessageName numberOfLines={1}>{user?.name ?? ''}</LastRoomMessageName>
      <AudioRow>
        <PlayButton>
          <PlayIcon width={10} height={10} color="#1F2937" />
        </PlayButton>
        <LastRoomMessageText numberOfLines={1}>
          {body?.trim() ? body : 'audio'}
        </LastRoomMessageText>
      </AudioRow>
    </LastRoomMessageContainer>
  );
};

export default LastAudioMessage;
