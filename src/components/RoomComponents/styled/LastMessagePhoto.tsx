import React, { FC } from 'react';
import styled from 'styled-components/native';
import { LastMessage } from '../../../types/types';
import {
  LastMessageImg,
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
  ShadeWrapper,
} from './StyledRoomComponents';
import { View } from 'react-native';

const PhotoContainer = styled.View`
  position: relative;
  width: 20px;
  height: 20px;
  overflow: hidden;
  border-radius: 8px;
  width: 20px;
  height: 20px;
  object-fit: cover;
  pointer-events: none;
`;

interface LastMessagePhotoProps
  extends Pick<LastMessage, 'user' | 'originalName' | 'locationPreview'> {}

const LastMessagePhoto: FC<LastMessagePhotoProps> = ({
  user,
  locationPreview,
  originalName,
}) => {
  return (
    <LastRoomMessageContainer>
      <LastRoomMessageName>{user?.name || ''}:</LastRoomMessageName>
      <View
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '4px',
        }}
      >
        <PhotoContainer>
          <ShadeWrapper>
            <LastMessageImg src={locationPreview} />
          </ShadeWrapper>
        </PhotoContainer>
        <LastRoomMessageText>{originalName || 'file'}</LastRoomMessageText>
      </View>
    </LastRoomMessageContainer>
  );
};

export default LastMessagePhoto;
