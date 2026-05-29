import { View, Text, StyleSheet, Modal, TouchableOpacity, SafeAreaView } from 'react-native';
import {
  MediaContainer,
  MediaImage,
} from './StyledInputComponents/StyledInputComponents';
import { FileIcon } from '../../assets/icons';
import { RemoveButton, RemoveButtonText } from './StyledComponents';
import { FC, useState } from 'react';
import { MediaFile } from '../../types/types';
import { useVideoPlayer, VideoView } from 'expo-video';

interface MediaFilePreviewProps {
  filePreviews: MediaFile[];
  handleRemoveImage: (index: number) => void;
}

const VideoThumb: FC<{ uri: string; onPress: () => void }> = ({
  uri,
  onPress,
}) => {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={styles.videoThumb}
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
        pointerEvents="none"
      />
      <View style={styles.playOverlay}>
        <Text style={styles.playIcon}>▶</Text>
      </View>
    </TouchableOpacity>
  );
};

const FullscreenPreviewVideo: FC<{ uri: string }> = ({ uri }) => {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.fullVideo}
      contentFit="contain"
      nativeControls
      surfaceType="textureView"
    />
  );
};

export const MediaFilePreview: FC<MediaFilePreviewProps> = ({
  filePreviews,
  handleRemoveImage,
}) => {
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  return (
    <MediaContainer>
      {filePreviews.map((file, index) => {
        const isImage = file.type?.startsWith('image');
        const isVideo = file.type?.startsWith('video');
        return (
          <View key={`${file.name}_${index}`}>
            {isImage ? (
              <MediaImage source={{ uri: file.uri }} />
            ) : isVideo ? (
              <VideoThumb uri={file.uri} onPress={() => setPreviewUri(file.uri)} />
            ) : (
              <View style={{ width: 70, height: 70, borderRadius: 8 }}>
                <FileIcon width={70} height={70} />
              </View>
            )}
            <RemoveButton onPress={() => handleRemoveImage(index)}>
              <RemoveButtonText>&times;</RemoveButtonText>
            </RemoveButton>
          </View>
        );
      })}

      <Modal visible={!!previewUri} animationType="fade" transparent>
        <SafeAreaView style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setPreviewUri(null)}
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          {previewUri && <FullscreenPreviewVideo uri={previewUri} />}
        </SafeAreaView>
      </Modal>
    </MediaContainer>
  );
};

const styles = StyleSheet.create({
  videoThumb: {
    width: 70,
    height: 70,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  playIcon: {
    fontSize: 24,
    color: '#fff',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '600',
  },
  fullVideo: {
    width: '100%',
    height: '70%',
  },
});
