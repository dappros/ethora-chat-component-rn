import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useT } from '../../i18n/useT';

interface MediaUploadOverlayProps {
  /** `uploading` shows progress; `failed` shows the reason and a Retry. */
  status: 'uploading' | 'failed';
  /** 0 to 100, while uploading. */
  progress?: number;
  /** Re-runs this file's upload. Only offered for a failed file. */
  onRetry?: () => void;
}

/**
 * Covers one tile of an outgoing media message while its file uploads, and
 * offers Retry when it did not. The scrim sits on the picture itself, so its
 * colours are fixed rather than taken from the theme.
 */
const MediaUploadOverlay: React.FC<MediaUploadOverlayProps> = ({
  status,
  progress = 0,
  onRetry,
}) => {
  const t = useT();
  const percent = Math.min(100, Math.max(0, Math.round(progress)));

  if (status === 'failed') {
    return (
      <View testID="media-upload-overlay" style={styles.overlay}>
        <Text style={styles.failedText}>{t('attachment.uploadFailed')}</Text>
        {onRetry && (
          <Pressable
            testID="media-upload-retry"
            accessibilityRole="button"
            accessibilityLabel={t('attachment.retryUpload')}
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('attachment.retryUpload')}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View testID="media-upload-overlay" style={styles.overlay}>
      <ActivityIndicator size="small" color="#FFFFFF" />
      <Text style={styles.progressText}>{`${percent}%`}</Text>
      <View style={styles.track} accessibilityRole="progressbar">
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
};

export default MediaUploadOverlay;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
    backgroundColor: 'rgba(8, 12, 24, 0.5)',
  },
  progressText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  fill: {
    height: 3,
    backgroundColor: '#FFFFFF',
  },
  failedText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  retry: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  retryText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
});
