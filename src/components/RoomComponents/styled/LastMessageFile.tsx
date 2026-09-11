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
import { useFileToken } from '../../../hooks/useFileToken';
import {
  appendFileToken,
  isSecureFileUrl,
  requestFileTokenRecovery,
} from '../../../helpers/secureFileUrl';
import { getDisplayFileName } from '../../../helpers/getDisplayFileName';

interface LastMessageFileProps
  extends Pick<
    LastMessage,
    'user' | 'originalName' | 'fileName' | 'mimetype' | 'locationPreview'
  > {}

const fallbackImage =
  'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg';

const LastMessageFile: FC<LastMessageFileProps> = ({
  user,
  originalName,
  fileName,
  mimetype,
  locationPreview,
}) => {
  const [imgSrc, setImgSrc] = useState(locationPreview);
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
        {imgSrc ? (
          <Image
            source={{ uri: appendFileToken(imgSrc, fileToken) }}
            style={{
              borderRadius: 16,
              width: 20,
              height: 20,
            }}
            onError={() => {
              if (isSecureFileUrl(imgSrc)) {
                requestFileTokenRecovery();
              }
              setImgSrc(fallbackImage);
            }}
          />
        ) : (
          <FileIcon style={{ width: '20px', height: '20px' }} />
        )}
        <LastRoomMessageText>{displayName}</LastRoomMessageText>
      </View>
    </LastRoomMessageContainer>
  );
};

export default LastMessageFile;
