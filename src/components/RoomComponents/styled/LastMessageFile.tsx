import React, { FC, useState } from 'react';
import styled from 'styled-components';
import { LastMessage } from '../../../types/types';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
} from './StyledRoomComponents';
import { FileIcon } from '../../../assets/icons';
import { Image, View } from 'react-native';

interface LastMessageFileProps
  extends Pick<LastMessage, 'user' | 'originalName' | 'locationPreview'> {}

const fallbackImage =
  'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg';

const LastMessageFile: FC<LastMessageFileProps> = ({
  user,
  originalName,
  locationPreview,
}) => {
  const [imgSrc, setImgSrc] = useState(locationPreview);

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
        {imgSrc ? (
          <Image
            source={{ uri: imgSrc }}
            style={{
              borderRadius: 16,
              width: 20,
              height: 20,
            }}
            onError={() => setImgSrc(fallbackImage)}
          />
        ) : (
          <FileIcon style={{ width: '20px', height: '20px' }} />
        )}
        <LastRoomMessageText>{originalName || 'file'}</LastRoomMessageText>
      </View>
    </LastRoomMessageContainer>
  );
};

export default LastMessageFile;
