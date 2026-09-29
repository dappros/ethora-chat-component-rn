import React, { FC } from 'react';
import { useFileToken } from '../../../hooks/useFileToken';
import { appendFileToken } from '../../../helpers/secureFileUrl';
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
import { getDisplayFileName } from '../../../helpers/getDisplayFileName';

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
  extends Pick<
    LastMessage,
    'user' | 'originalName' | 'fileName' | 'mimetype' | 'locationPreview'
  > {}

const LastMessagePhoto: FC<LastMessagePhotoProps> = ({
  user,
  locationPreview,
  originalName,
  fileName,
  mimetype,
}) => {
  const fileToken = useFileToken();
  // Bug #40: prefer the sender's original name over the stored hash
  // name; only fall back to the generic "file" label when neither is
  // present at all (avoids a synthetic "media_<timestamp>.bin" here).
  const displayName = originalName || fileName
    ? getDisplayFileName({ originalName, fileName, mimetype })
    : 'file';
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
            <LastMessageImg src={appendFileToken(locationPreview, fileToken)} />
          </ShadeWrapper>
        </PhotoContainer>
        <LastRoomMessageText>{displayName}</LastRoomMessageText>
      </View>
    </LastRoomMessageContainer>
  );
};

export default LastMessagePhoto;
