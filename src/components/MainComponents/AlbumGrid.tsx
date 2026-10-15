import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { IAttachment, ModalFile } from '../../types/types';
import CustomMessageImage from '../styled/MessageImage';
import CustomMessageVideo from '../styled/VideoMessage';
import { getAttachmentName } from '../../helpers/attachments';
import { getFileKind } from '../../helpers/fileKind';
import { getAlbumFrame, getAlbumLayout } from '../../helpers/albumLayout';
import { MEDIA_MAX_W } from '../../helpers/mediaDimensions';
import { appendFileToken } from '../../helpers/secureFileUrl';
import { useFileToken } from '../../hooks/useFileToken';
import { useT } from '../../i18n/useT';
import {
  setActiveFile,
  setActiveModal,
} from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import MediaUploadOverlay from './MediaUploadOverlay';

interface AlbumGridProps {
  /** The pictures and videos of one message, in order. */
  attachments: IAttachment[];
  /** Width of the whole grid; the bubble's media width by default. */
  width?: number;
  /** Re-runs the upload of the tile at this position (a failed outgoing file). */
  onRetryTile?: (position: number) => void;
}

/**
 * Photo and video album of a message with several media files. The geometry
 * comes from getAlbumLayout / getAlbumFrame; every tile is the ordinary
 * picture or video component sized to its cell. A tap opens the viewer on
 * that file with the whole album as its siblings, so the viewer can page
 * through files the grid does not show. The last tile of a long album carries
 * a "+N" overlay for the files folded behind it.
 */
const AlbumGrid: React.FC<AlbumGridProps> = ({
  attachments,
  width = MEDIA_MAX_W,
  onRetryTile,
}) => {
  const t = useT();
  const dispatch = useDispatch();
  const fileToken = useFileToken();

  const layout = useMemo(
    () => getAlbumLayout(attachments.length),
    [attachments.length]
  );
  const frame = useMemo(() => getAlbumFrame(layout, width), [layout, width]);

  const siblings: ModalFile[] = useMemo(
    () =>
      attachments.map((attachment) => ({
        fileName: getAttachmentName(attachment),
        originalName: attachment.originalName,
        fileURL: appendFileToken(attachment.location, fileToken) || '',
        mimetype: attachment.mimetype || '',
        duration: attachment.duration,
      })),
    [attachments, fileToken]
  );

  const openAt = useCallback(
    (index: number) => {
      const target = siblings[index];
      // A file still on its way up has no server copy to open yet.
      if (!target || !target.fileURL || attachments[index]?.uploadStatus) {return;}
      dispatch(setActiveFile({ ...target, siblings, index }));
      dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
    },
    [attachments, dispatch, siblings]
  );

  return (
    <View
      testID="album-grid"
      style={[styles.grid, { width: frame.width, height: frame.height }]}
    >
      {attachments.slice(0, layout.visible).map((attachment, position) => {
        const style = frame.tiles[position]!;
        const tile = {
          width: Number(style.width),
          height: Number(style.height),
        };
        const fileName = getAttachmentName(attachment);
        const kind = getFileKind({
          mimetype: attachment.mimetype,
          name: fileName,
          url: attachment.location,
          duration: attachment.duration,
        });
        // An outgoing tile shows the file on this device until its upload
        // has given it a server copy.
        const outgoing = Boolean(attachment.uploadStatus);
        const fileURL = outgoing
          ? attachment.localUrl || ''
          : appendFileToken(attachment.location, fileToken) || '';
        const preview = outgoing
          ? attachment.localUrl || undefined
          : appendFileToken(attachment.locationPreview, fileToken);
        const showMore = position === layout.visible - 1 && layout.hidden > 0;
        const open = () => openAt(position);

        return (
          <View
            key={attachment.attachmentId || `${position}-${fileName}`}
            testID={`album-tile-${position}`}
            style={style}
          >
            {kind === 'video' ? (
              <CustomMessageVideo
                fileName={fileName}
                originalName={attachment.originalName}
                fileURL={fileURL}
                previewURL={preview}
                mimetype={attachment.mimetype || ''}
                tile={tile}
                onOpen={outgoing ? undefined : open}
              />
            ) : (
              <CustomMessageImage
                fileName={fileName}
                originalName={attachment.originalName}
                fileURL={fileURL}
                locationPreview={preview}
                mimetype={attachment.mimetype || ''}
                tile={tile}
                onOpen={outgoing ? undefined : open}
              />
            )}
            {outgoing && attachment.uploadStatus && (
              <MediaUploadOverlay
                status={attachment.uploadStatus}
                progress={attachment.uploadProgress}
                onRetry={onRetryTile ? () => onRetryTile(position) : undefined}
              />
            )}
            {showMore && (
              <Pressable
                testID="album-more"
                accessibilityRole="button"
                accessibilityLabel={t('attachment.moreLabel', {
                  count: layout.hidden,
                })}
                onPress={open}
                style={styles.more}
              >
                <Text style={styles.moreText}>
                  {t('attachment.moreCount', { count: layout.hidden })}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
};

export default AlbumGrid;

const styles = StyleSheet.create({
  grid: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 10,
  },
  more: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    // Sits on the photo itself, so it stays hard-coded: it must read on the
    // picture, not on the theme.
    backgroundColor: 'rgba(8, 12, 24, 0.5)',
  },
  moreText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '600',
  },
});
