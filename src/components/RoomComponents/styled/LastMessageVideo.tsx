import React, { FC } from 'react';
import { useFileToken } from '../../../hooks/useFileToken';
import { appendFileToken } from '../../../helpers/secureFileUrl';
import styled from 'styled-components/native';
import { LastMessage } from '../../../types/types';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
  ShadeWrapper,
} from './StyledRoomComponents';
import { Text, View } from 'react-native';
import { getDisplayFileName } from '../../../helpers/getDisplayFileName';

const VideoContainer = styled.View`
  position: relative;
  width: 20px;
  height: 20px;
  overflow: hidden;
  border-radius: 8px;
`;

const Thumbnail = styled.Image`
  width: 20px;
  height: 20px;
  border-radius: 8px;
`;

const PlayButton = styled.View`
  position: absolute;
  width: 8px;
  height: 9px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: white;
  font-size: 10px;
  pointer-events: none;
  z-index: 100;
`;

interface LastMessageVideoProps
  extends Pick<
    LastMessage,
    'user' | 'location' | 'originalName' | 'fileName' | 'mimetype'
  > {}

const LastMessageVideo: FC<LastMessageVideoProps> = ({
  user,
  location,
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
        <VideoContainer>
          <ShadeWrapper>
            <Thumbnail src={appendFileToken(location, fileToken)} />
          </ShadeWrapper>
          <PlayButton><Text>▶</Text></PlayButton>
        </VideoContainer>
        <LastRoomMessageText>{displayName}</LastRoomMessageText>
      </View>
    </LastRoomMessageContainer>
  );
};

export default LastMessageVideo;
