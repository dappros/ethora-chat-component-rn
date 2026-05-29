import React from 'react';
import { IMessage } from '../../types/types';
import FileDownload from '../styled/UnsupportedType';
import CustomMessageImage from '../styled/MessageImage';
import CustomMessageVideo from '../styled/VideoMessage';
import AudioMessage from '../styled/AudioMessage';
import { Text } from 'react-native';
import { deriveDisplayFilename } from '../../helpers/mimeToExtension';

interface MediaMessageProps {
  mimeType?: string;
  message?: IMessage;
  location?: string;
  messageText?: string;
  isUser: boolean;
}

const MediaMessage: React.FC<MediaMessageProps> = ({
  mimeType,
  location,
  messageText,
  message,
  isUser,
}) => {
  if (mimeType) {
    const displayName = deriveDisplayFilename({
      fileName: message?.fileName,
      originalName: (message as any)?.originalName,
      url: location || messageText,
      mime: mimeType,
    });
    switch (true) {
      case mimeType.startsWith('image/'):
        return (
          <CustomMessageImage
            fileName={displayName}
            fileURL={messageText || ''}
            mimetype={mimeType}
          />
        );
      case mimeType.startsWith('video/'):
        return (
          <CustomMessageVideo
            fileName={displayName}
            fileURL={location || ''}
            mimetype={mimeType}
          />
        );
      case mimeType.startsWith('audio/'): {
        return <AudioMessage src={location || ''} />;
      }
      default: {
        // Many backends tag binary payloads (PDFs, DOCX, archives) as
        // application/octet-stream; sniff the filename extension for the
        // legitimate audio case before falling through to FileDownload.
        if (mimeType.includes('application/octet-stream')) {
          if (/\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(displayName)) {
            return <AudioMessage src={location || ''} />;
          }
        }
        return (
          <FileDownload
            fileURL={location ? location : ''}
            fileName={displayName}
            mimetype={mimeType}
            isUser={isUser}
          />
        );
      }
    }
  }
  return <Text>Unsupported media type</Text>;
};

export default MediaMessage;
