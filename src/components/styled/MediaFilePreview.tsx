import { View, Text, StyleSheet, Modal, TouchableOpacity, SafeAreaView } from 'react-native';
import {
  MediaContainer,
  MediaImage,
} from './StyledInputComponents/StyledInputComponents';
import { FileIcon } from '../../assets/icons';
import { RemoveButton, RemoveButtonText } from './StyledComponents';
import { FC, useState } from 'react';
import { MediaFile } from '../../types/types';
import { Video, ResizeMode } from 'expo-av';

interface MediaFilePreviewProps {
  filePreviews: MediaFile[];
  handleRemoveImage: (index: number) => void;
}

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
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setPreviewUri(file.uri)}
                style={styles.videoThumb}
              >
                <Video
                  source={{ uri: file.uri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode={ResizeMode.COVER}
                  shouldPlay={false}
                  isMuted
                />
                <View style={styles.playOverlay}>
                  <Text style={styles.playIcon}>▶</Text>
                </View>
              </TouchableOpacity>
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
          {previewUri && (
            <Video
              source={{ uri: previewUri }}
              style={styles.fullVideo}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
            />
          )}
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
