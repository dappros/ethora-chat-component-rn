import React, { useMemo } from 'react';
import { IAttachment, IMessage } from '../../types/types';
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
import { getAttachmentName, getMessageAttachments } from '../../helpers/attachments';
import { getMessageCaption } from '../../helpers/caption';
import { getFileKind, isAlbumKind } from '../../helpers/fileKind';
import { getDisplayFileName } from '../../helpers/getDisplayFileName';
import { FileIcon, PlayIcon } from '../../assets/icons';
import { defaultMediaDims } from '../../helpers/mediaDimensions';
import { useFileToken } from '../../hooks/useFileToken';
import { appendFileToken } from '../../helpers/secureFileUrl';
import { useTheme } from '../../hooks/useTheme';
import SealedAttachment from './SealedAttachment';
import AlbumGrid from './AlbumGrid';
import MediaCaption from '../MessageBubble/MediaCaption';

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
  const theme = useTheme();
  const statusLabel = getPendingStatusLabel(mimeType);
  const isImage = mimeType?.startsWith('image/');
  const isVideo = mimeType?.startsWith('video/');
  const isAudio =
    mimeType?.startsWith('audio/') ||
    mimeType?.includes('application/octet-stream');
  const primaryColor = theme.primary;
  // Colour overrides only; layout stays in the static StyleSheet below.
  const t = useMemo(
    () => ({
      card: { backgroundColor: theme.surfaceSecondary },
      preview: { backgroundColor: theme.surfaceHighlight },
      text: { color: theme.text },
      secondary: { color: theme.textSecondary },
      track: { backgroundColor: theme.border },
      pill: { backgroundColor: theme.surface },
    }),
    [theme]
  );

  if (isImage && previewUri) {
    return (
      <View style={[styles.pendingImageWrapper, t.card]}>
        <Image
          source={{ uri: previewUri }}
          style={styles.pendingImage}
          resizeMode="cover"
        />
        {/* Scrim + white label sit on top of the image itself, so they
            stay hard-coded: they must read on the photo, not the theme. */}
        <View style={styles.pendingImageOverlay}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.pendingOverlayText}>{statusLabel}</Text>
        </View>
      </View>
    );
  }

  if (isVideo) {
    return (
      <View style={[styles.pendingVideoCard, t.card]}>
        <View style={[styles.pendingVideoPreview, t.preview]}>
          <View style={styles.pendingVideoIcon}>
            <PlayIcon width={24} height={24} />
          </View>
          <ActivityIndicator size="small" color={theme.textSecondary} />
        </View>
        <Text style={[styles.pendingVideoLabel, t.text]}>{fileName}</Text>
        <Text style={[styles.pendingVideoStatus, t.secondary]}>
          {statusLabel}
        </Text>
      </View>
    );
  }

  if (isAudio) {
    return (
      <View style={[styles.pendingAudioCard, t.card]}>
        <View
          style={[
            styles.pendingAudioButton,
            { backgroundColor: primaryColor },
          ]}
        >
          <PlayIcon width={18} height={18} color={theme.textOnPrimary} />
        </View>
        <View style={styles.pendingAudioContent}>
          <View style={[styles.pendingAudioTrack, t.track]}>
            <View
              style={[
                styles.pendingAudioTrackFill,
                { backgroundColor: primaryColor },
              ]}
            />
          </View>
          <View style={styles.pendingAudioMeta}>
            <Text style={[styles.pendingAudioTime, t.secondary]}>0:00</Text>
            <View style={[styles.pendingAudioStatusPill, t.pill]}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
              <Text style={[styles.pendingAudioStatusText, t.secondary]}>
                {statusLabel}
              </Text>
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

interface AttachmentCardProps {
  attachment: IAttachment;
  /** Position in the message; the voice waveform belongs to #0 only. */
  index: number;
  message?: IMessage;
  isUser: boolean;
  fileToken?: string | null;
}

/** One file of a message: the picture, video, player or file card it gets. */
const AttachmentCard: React.FC<AttachmentCardProps> = ({
  attachment,
  index,
  message,
  isUser,
  fileToken,
}) => {
  const mimeType = attachment.mimetype || '';
  const rawLocation = attachment.location;
  const rawPreview = attachment.locationPreview;
  const location = appendFileToken(rawLocation, fileToken);
  const previewText = appendFileToken(rawPreview, fileToken);
  const originalName = attachment.originalName;
  const duration = attachment.duration ?? (message as any)?.duration;
  const waveForm = index === 0 ? (message as any)?.waveForm : undefined;

  const displayName = getDisplayFileName({
    originalName,
    fileName: attachment.fileName,
    location: rawLocation || rawPreview,
    mimetype: mimeType,
  });
  const kind = getFileKind({
    mimetype: mimeType,
    name: displayName,
    url: rawLocation,
    duration,
    waveForm,
    originalName,
  });

  // The sender's own voice note plays from its local file while it
  // uploads, waveform and all - no placeholder card in between.
  if (message?.pending && kind === 'audio' && (previewText || location)) {
    return (
      <AudioMessage
        src={previewText || location || ''}
        mimeType={mimeType}
        fileName={displayName}
        duration={duration}
        waveForm={waveForm}
        isUser={isUser}
      />
    );
  }
  if (message?.pending) {
    return (
      <PendingMediaMessage
        fileName={displayName}
        mimeType={mimeType}
        previewUri={previewText || location || ''}
        isUser={isUser}
        size={index === 0 ? message?.size : attachment.size}
      />
    );
  }

  switch (kind) {
    case 'image':
      return (
        <CustomMessageImage
          fileName={displayName}
          originalName={originalName}
          // Full-size original: opened by the preview modal.
          fileURL={location || previewText || ''}
          // ...and the thumbnail the bubble actually renders, which is
          // what the web client shows too.
          locationPreview={previewText}
          mimetype={mimeType}
        />
      );
    case 'video':
      return (
        <CustomMessageVideo
          fileName={displayName}
          originalName={originalName}
          fileURL={location || ''}
          // The message's locationPreview is the poster frame the backend
          // generated for this video. Handing it over lets the bubble render
          // as a still + play badge instead of mounting a video surface per
          // row (see VideoMessage).
          previewURL={previewText}
          mimetype={mimeType}
        />
      );
    case 'audio':
      // Covers audio/*, octet-stream voice notes and the voice-message
      // heuristics of isLikelyAudio (customer-reported #9 voicemail fix):
      // a voicemail shipped as octet-stream with no audio extension still
      // gets the player instead of a broken `.bin` file card.
      return (
        <AudioMessage
          src={location || ''}
          mimeType={mimeType}
          fileName={displayName}
          originalName={originalName}
          duration={duration}
          waveForm={waveForm}
          isUser={isUser}
        />
      );
    default:
      return (
        <FileDownload
          fileURL={location ? location : ''}
          fileName={displayName}
          mimetype={mimeType}
          isUser={isUser}
          originalName={originalName}
          duration={duration}
          waveForm={waveForm}
        />
      );
  }
};

const MediaMessage: React.FC<MediaMessageProps> = ({
  mimeType,
  location: rawLocation,
  messageText: rawMessageText,
  message,
  isUser,
}) => {
  const fileToken = useFileToken();
  const theme = useTheme();

  // Order of truth: the message's own attachments, else its flat fields, else
  // the props the bubble was handed (a bare file with no message around it).
  const attachments = useMemo(
    () =>
      getMessageAttachments(
        message ?? {
          location: rawLocation,
          locationPreview: rawMessageText,
          mimetype: mimeType,
        }
      ),
    [message, rawLocation, rawMessageText, mimeType]
  );
  const caption = message ? getMessageCaption(message) : undefined;

  if (message?.clientEncrypted === 'true') {
    // A sealed file has nothing to show until it is opened, so each one is a
    // card of its own (SealedAttachment); the caption came out of the
    // encrypted body.
    return (
      <>
        <SealedAttachment message={message} isUser={isUser} />
        <MediaCaption text={caption} isUser={isUser} />
      </>
    );
  }

  if (attachments.length === 0) {
    return <Text style={{ color: theme.text }}>Unsupported media type</Text>;
  }

  const card = (attachment: IAttachment, index: number) => (
    <AttachmentCard
      key={attachment.attachmentId || `${index}-${attachment.location}`}
      attachment={attachment}
      index={index}
      message={message}
      isUser={isUser}
      fileToken={fileToken}
    />
  );

  // Pictures and videos share one album when there are two or more of them;
  // documents and voice notes follow as one card each. A lone picture is the
  // ordinary bubble picture, exactly as a single-file message always was.
  const album = message?.pending
    ? []
    : attachments.filter(
        (attachment) =>
          Boolean(attachment.location) &&
          isAlbumKind(
            getFileKind({
              mimetype: attachment.mimetype,
              name: getAttachmentName(attachment),
              url: attachment.location,
              duration: attachment.duration,
            })
          )
      );
  const useAlbum = album.length >= 2;
  const rest = useAlbum
    ? attachments.filter((attachment) => !album.includes(attachment))
    : attachments;

  // One file and no text: the card alone, no wrapper around it.
  if (!useAlbum && attachments.length === 1 && !caption) {
    return card(attachments[0]!, 0);
  }

  return (
    <View style={styles.stack}>
      {useAlbum && <AlbumGrid attachments={album} />}
      {rest.map((attachment) => card(attachment, attachments.indexOf(attachment)))}
      <MediaCaption text={caption} isUser={isUser} />
    </View>
  );
};

export default MediaMessage;

const styles = StyleSheet.create({
  stack: {
    alignItems: 'flex-start',
    gap: 4,
  },
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
