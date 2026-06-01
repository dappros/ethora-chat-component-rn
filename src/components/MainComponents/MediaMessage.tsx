import React from 'react';
import { IMessage } from '../../types/types';
import FileDownload from '../styled/UnsupportedType';
import CustomMessageImage from '../styled/MessageImage';
import CustomMessageVideo from '../styled/VideoMessage';
import AudioMessage from '../styled/AudioMessage';
import { Text } from 'react-native';
import { deriveDisplayFilename, isLikelyAudio } from '../../helpers/mimeToExtension';

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
        // Some senders (notably the web app's voice-message uploader)
        // ship audio as `application/octet-stream` with no audio file
        // extension. `isLikelyAudio` recognises those via the URL path,
        // filename, or voice-message naming hints (voicemail-,
        // voice-note-, recording-, …) so we still render the AudioMessage
        // player instead of falling through to the generic FileDownload
        // card (where the voicemail rendered as a broken `.bin`
        // attachment). Customer-reported #9 voicemail fix.
        if (isLikelyAudio(mimeType, displayName, location)) {
          return <AudioMessage src={location || ''} />;
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
