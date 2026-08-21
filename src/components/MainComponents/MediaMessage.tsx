import React from 'react';
import { IMessage } from '../../types/types';
import FileDownload from '../styled/UnsupportedType';
import CustomMessageImage from '../styled/MessageImage';
import CustomMessageVideo from '../styled/VideoMessage';
import AudioMessage from '../styled/AudioMessage';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deriveDisplayFilename, isLikelyAudio } from '../../helpers/mimeToExtension';
import { FileIcon, PlayIcon } from '../../assets/icons';
import { defaultMediaDims } from '../../helpers/mediaDimensions';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useFileToken } from '../../hooks/useFileToken';
import { appendFileToken } from '../../helpers/secureFileUrl';

interface MediaMessageProps {
  mimeType?: string;
  message?: IMessage;
  location?: string;
  messageText?: string;
  isUser: boolean;
}

const pendingImageDims = defaultMediaDims();

const getPendingStatusLabel = (mimeType?: string) => {
  if (mimeType?.startsWith('image/')) {
    return 'Uploading image';
  }
  if (mimeType?.startsWith('video/')) {
    return 'Uploading video';
  }
  if (
    mimeType?.startsWith('audio/') ||
    mimeType?.includes('application/octet-stream')
  ) {
    return 'Uploading audio';
  }
  return 'Uploading file';
};

const PendingMediaMessage: React.FC<{
  fileName: string;
  mimeType?: string;
  previewUri?: string;
  isUser: boolean;
  size?: string;
}> = ({ fileName, mimeType, previewUri, isUser, size }) => {
  const { config } = useChatSettingState();
  const statusLabel = getPendingStatusLabel(mimeType);
  const isImage = mimeType?.startsWith('image/');
  const isVideo = mimeType?.startsWith('video/');
  const isAudio =
    mimeType?.startsWith('audio/') ||
    mimeType?.includes('application/octet-stream');
  const primaryColor = config?.colors?.primary || '#0A84FF';

  if (isImage && previewUri) {
    return (
      <View style={styles.pendingImageWrapper}>
        <Image
          source={{ uri: previewUri }}
          style={styles.pendingImage}
          resizeMode="cover"
        />
        <View style={styles.pendingImageOverlay}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.pendingOverlayText}>{statusLabel}</Text>
        </View>
      </View>
    );
  }

  if (isVideo) {
    return (
      <View style={styles.pendingVideoCard}>
        <View style={styles.pendingVideoPreview}>
          <View style={styles.pendingVideoIcon}>
            <PlayIcon width={24} height={24} />
          </View>
          <ActivityIndicator size="small" color="#5B6B8C" />
        </View>
        <Text style={styles.pendingVideoLabel}>{fileName}</Text>
        <Text style={styles.pendingVideoStatus}>{statusLabel}</Text>
      </View>
    );
  }

  if (isAudio) {
    return (
      <View style={styles.pendingAudioCard}>
        <View
          style={[
            styles.pendingAudioButton,
            { backgroundColor: primaryColor },
          ]}
        >
          <PlayIcon width={18} height={18} color="#fff" />
        </View>
        <View style={styles.pendingAudioContent}>
          <View style={styles.pendingAudioTrack}>
            <View
              style={[
                styles.pendingAudioTrackFill,
                { backgroundColor: primaryColor },
              ]}
            />
          </View>
          <View style={styles.pendingAudioMeta}>
            <Text style={styles.pendingAudioTime}>0:00</Text>
            <View style={styles.pendingAudioStatusPill}>
              <ActivityIndicator size="small" color="#5B6B8C" />
              <Text style={styles.pendingAudioStatusText}>{statusLabel}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <FileDownload
      fileURL={previewUri || ''}
      fileName={fileName}
      mimetype={mimeType || 'application/octet-stream'}
      size={size}
      isUser={isUser}
      pending
      placeholderIcon={<FileIcon width={36} height={36} />}
    />
  );
};

const MediaMessage: React.FC<MediaMessageProps> = ({
  mimeType,
  location: rawLocation,
  messageText: rawMessageText,
  message,
  isUser,
}) => {
  const fileToken = useFileToken();
  const location = appendFileToken(rawLocation, fileToken);
  const messageText = appendFileToken(rawMessageText, fileToken);

  if (mimeType) {
    const displayName = deriveDisplayFilename({
      fileName: message?.fileName,
      originalName: (message as any)?.originalName,
      url: rawLocation || rawMessageText,
      mime: mimeType,
    });
    const isAudioPayload = isLikelyAudio(
      mimeType,
      displayName,
      rawLocation,
      {
        duration: (message as any)?.duration,
        waveForm: (message as any)?.waveForm,
        originalName: (message as any)?.originalName,
      }
    );
    if (message?.pending) {
      return (
        <PendingMediaMessage
          fileName={displayName}
          mimeType={mimeType}
          previewUri={messageText || location || ''}
          isUser={isUser}
          size={message?.size}
        />
      );
    }
    switch (true) {
      case mimeType.startsWith('image/'):
        return (
          <CustomMessageImage
            fileName={displayName}
            // Full-size original: opened by the preview modal.
            fileURL={location || messageText || ''}
            // ...and the thumbnail the bubble actually renders, which is
            // what the web client shows too.
            locationPreview={messageText}
            mimetype={mimeType}
          />
        );
      case mimeType.startsWith('video/'):
        return (
          <CustomMessageVideo
            fileName={displayName}
            fileURL={location || ''}
            // `messageText` is the message's locationPreview — the poster
            // frame the backend generated for this video. Handing it over
            // lets the bubble render as a still + play badge instead of
            // mounting a video surface per row (see VideoMessage).
            previewURL={messageText}
            mimetype={mimeType}
          />
        );
      case mimeType.startsWith('audio/'): {
        return (
          <AudioMessage
            src={location || ''}
            mimeType={mimeType}
            fileName={displayName}
            originalName={(message as any)?.originalName}
            duration={(message as any)?.duration}
            waveForm={(message as any)?.waveForm}
          />
        );
      }
      case mimeType.includes('application/octet-stream'): {
        return (
          <AudioMessage
            src={location || ''}
            mimeType={mimeType}
            fileName={displayName}
            originalName={(message as any)?.originalName}
            duration={(message as any)?.duration}
            waveForm={(message as any)?.waveForm}
          />
        );
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
        if (isAudioPayload) {
          return (
            <AudioMessage
              src={location || ''}
              mimeType={mimeType}
              fileName={displayName}
              originalName={(message as any)?.originalName}
              duration={(message as any)?.duration}
              waveForm={(message as any)?.waveForm}
            />
          );
        }
        return (
          <FileDownload
            fileURL={location ? location : ''}
            fileName={displayName}
            mimetype={mimeType}
            isUser={isUser}
            originalName={(message as any)?.originalName}
            duration={(message as any)?.duration}
            waveForm={(message as any)?.waveForm}
          />
        );
      }
    }
  }
  return <Text>Unsupported media type</Text>;
};

export default MediaMessage;

const styles = StyleSheet.create({
  pendingImageWrapper: {
    width: pendingImageDims.width,
    height: pendingImageDims.height,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#EAF0FB',
  },
  pendingImage: {
    width: '100%',
    height: '100%',
  },
  pendingImageOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(17, 24, 39, 0.28)',
  },
  pendingOverlayText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingVideoCard: {
    width: 220,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F3F6FC',
    gap: 10,
  },
  pendingVideoPreview: {
    height: 144,
    borderRadius: 10,
    backgroundColor: '#DCE6F7',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pendingVideoIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingVideoLabel: {
    color: '#141414',
    fontSize: 14,
    fontWeight: '600',
  },
  pendingVideoStatus: {
    color: '#5B6B8C',
    fontSize: 12,
    fontWeight: '500',
  },
  pendingAudioCard: {
    minWidth: 252,
    maxWidth: 288,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F6FC',
  },
  pendingAudioButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingAudioContent: {
    flex: 1,
    gap: 8,
  },
  pendingAudioTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#D0D7E6',
  },
  pendingAudioTrackFill: {
    width: '32%',
    height: '100%',
    borderRadius: 999,
  },
  pendingAudioMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pendingAudioTime: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '500',
  },
  pendingAudioStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  pendingAudioStatusText: {
    color: '#5B6B8C',
    fontSize: 12,
    fontWeight: '600',
  },
});
