import React, { useMemo, useState } from 'react';
import styled from 'styled-components/native';
import {
  CenterContainer,
  ModalContainerFullScreen,
} from '../styledModalComponents';
import { SaveIcon } from '../../../assets/icons';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { useDispatch, useSelector } from 'react-redux';
import Button from '../../styled/Button';
import { RootState } from '../../../roomStore';
import { FullScreenImage } from '../../styled/StyledInputComponents/MediaComponents';
import { setActiveFile } from '../../../roomStore/chatSettingsSlice';
import {
  Alert,
  Text,
  View,
  Platform,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { PlayIcon } from '../../../assets/icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useToast } from '../../../context/ToastContext';
import PdfViewer from './PdfView';
import DocumentViewer from './DocumentViewer';
import AudioMessage from '../../styled/AudioMessage';
import { ensureFilenameHasExtension } from '../../../helpers/mimeToExtension';

// MIME types Google's gview embed renders reliably. Everything else
// falls through to the info-card so the user can still download.
const GVIEW_PREVIEWABLE = new Set<string>([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/rtf',
]);
const isGviewPreviewable = (mime: string | undefined | null) => {
  if (!mime) {return false;}
  return GVIEW_PREVIEWABLE.has(mime.toLowerCase().split(';')[0]!.trim());
};

export const FullScreenVideo = styled.View`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

const ModalVideo: React.FC<{ uri: string }> = ({ uri }) => {
  const videoRef = React.useRef<any>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [showPlay, setShowPlay] = useState(true);

  let size: { w: number; h: number } | null = null;
  if (box && nat) {
    const scale = Math.min(box.w / nat.w, box.h / nat.h);
    size = { w: Math.round(nat.w * scale), h: Math.round(nat.h * scale) };
  }

  const handlePlay = async () => {
    setShowPlay(false);
    try {
      await videoRef.current?.playAsync();
    } catch {
      /* ignore */
    }
  };

  return (
    <View
      style={{ flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' }}
      onLayout={(e) =>
        setBox({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <View
        style={
          size
            ? { width: size.w, height: size.h }
            : { width: '100%', height: '100%' }
        }
      >
        <Video
          ref={videoRef}
          style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
          source={{ uri }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay={false}
          onReadyForDisplay={(e: any) => {
            const ns = e?.naturalSize;
            if (ns?.width && ns?.height) {
              let w = ns.width;
              let h = ns.height;
              if (ns.orientation === 'portrait' && w > h) {
                [w, h] = [h, w];
              }
              setNat({ w, h });
            }
          }}
          onPlaybackStatusUpdate={(s: any) => {
            if (s?.isPlaying) {setShowPlay(false);}
          }}
        />
        {/* Play affordance shown immediately on open so it's obvious the
            preview is a playable video; tapping starts playback and the
            native controls take over. */}
        {showPlay && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handlePlay}
            style={StyleSheet.absoluteFillObject}
          >
            <View style={styles.playOverlay}>
              <View style={styles.playButton}>
                <PlayIcon width={28} height={28} />
              </View>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

interface FilePreviewModalProps {
  handleCloseModal: any;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  handleCloseModal,
}) => {
  const dispatch = useDispatch();
  const { showToast } = useToast();

  const { activeFile } = useSelector(
    (state: RootState) => state.chatSettingStore
  );

  if (!activeFile) {return;}

  const requestStoragePermission = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting permission:', error);
      return false;
    }
  };

  const saveToGallery = async () => {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      Alert.alert(
        'Permission Denied',
        'Storage permission is required to save files to the gallery.'
      );
      return;
    }

    try {
      const fileName = ensureFilenameHasExtension(
        activeFile.fileName,
        activeFile.mimetype
      );

      const filePath = FileSystem.cacheDirectory + fileName;
      const download = await FileSystem.downloadAsync(activeFile.fileURL, filePath);

      if (download.status === 200) {
        await MediaLibrary.saveToLibraryAsync(download.uri);
        showToast({
          id: Date.now().toString(),
          title: 'Success',
          message: 'Save successful',
          type: 'success',
        });
      } else {
        Alert.alert('Error', 'Failed to save the file.');
      }
    } catch (err) {
      Alert.alert('Error', `Failed to save the file: ${activeFile.fileName}`);
    }
  };

  const saveFileToDownloads = async () => {
    try {
      // Always include a valid extension on the cache filename. expo-media-
      // library's createAssetAsync inspects the URI's extension and throws
      // "Could not get the file's extension" when missing — see bug #9 in
      // sdk-bug-tracker.md.
      const fileName = ensureFilenameHasExtension(
        activeFile.fileName,
        activeFile.mimetype
      );
      const filePath = FileSystem.cacheDirectory + fileName;
      const download = await FileSystem.downloadAsync(activeFile.fileURL, filePath);

      if (download.status === 200) {
        if (Platform.OS === 'android') {
          const hasPermission = await requestStoragePermission();
          if (hasPermission) {
            await MediaLibrary.createAssetAsync(download.uri);
          }
        }
        showToast({
          id: Date.now().toString(),
          title: 'Success',
          message: 'Save successful',
          type: 'success',
        });
      } else {
        Alert.alert('Error', 'Failed to save the file.');
      }
    } catch (err) {
      console.error('Error saving file:', err);
      Alert.alert('Error', 'Failed to save the file.');
    }
  };

  const saveClick = async () => {
    if (
      activeFile.mimetype.startsWith('image/') ||
      activeFile.mimetype.startsWith('video/')
    ) {
      await saveToGallery();
    } else {
      await saveFileToDownloads();
    }
  };

  const closeModal = () => {
    dispatch(
      setActiveFile({
        fileName: '',
        fileURL: '',
        mimetype: '',
      })
    );
    handleCloseModal?.();
  };

  const getMediaComponent = useMemo(() => {
    switch (true) {
      case activeFile.mimetype.startsWith('image/'):
        return (
          <FullScreenImage
            source={{
              uri:
                activeFile.fileURL ||
                'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg',
            }}
            resizeMode="contain"
            accessibilityLabel={activeFile.fileName}
          />
        );
      case activeFile.mimetype.startsWith('video/'):
        return <ModalVideo uri={activeFile.fileURL} />;
      case activeFile.mimetype.startsWith('audio/'):
        return (
          <View
            style={{
              width: '100%',
              padding: 20,
              gap: 12,
              backgroundColor: '#FFF8ED',
              borderRadius: 16,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600' }}>
              {ensureFilenameHasExtension(
                activeFile.fileName,
                activeFile.mimetype
              )}
            </Text>
            <AudioMessage src={activeFile.fileURL} />
          </View>
        );
      case activeFile.mimetype === 'application/pdf':
        return <PdfViewer pdfUrl={activeFile.fileURL} />;
      default: {
        const displayName = ensureFilenameHasExtension(
          activeFile.fileName,
          activeFile.mimetype
        );
        // Office docs (.docx / .xlsx / .pptx / .doc / .xls / .ppt /
        // .txt / .csv / .rtf) → render inline via Google's gview embed
        // — fixes the "blank preview" complaint for docs (bug #9).
        if (isGviewPreviewable(activeFile.mimetype)) {
          return (
            <DocumentViewer
              url={activeFile.fileURL}
              fileName={displayName}
            />
          );
        }
        // True last-resort fallback for genuinely unrenderable types
        // (binary blobs, exotic MIMEs). Friendly info card with the
        // filename so the user can still download.
        return (
          <View
            style={{
              backgroundColor: '#FFF8ED',
              borderRadius: 16,
              padding: 20,
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600' }}>
              {displayName}
            </Text>
            <Text style={{ color: '#666' }}>
              {activeFile.mimetype || 'unknown type'}
            </Text>
            <Text style={{ marginTop: 8 }}>
              This file format can't be previewed inline. Tap the save icon
              above to download it.
            </Text>
          </View>
        );
      }
    }
  }, [activeFile]);

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={closeModal}
        headerTitle={'File preview'}
        rightMenu={
          <>
            <Button onPress={saveClick}>
              <SaveIcon />
            </Button>
          </>
        }
      />

      <CenterContainer
        style={{
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          overflow: 'hidden',
          padding: 16,
          paddingBottom: 48,
          borderTopWidth: '1px',
          borderTopColor: '#f0f0f0',
        }}
      >
        {getMediaComponent}
      </CenterContainer>

    </ModalContainerFullScreen>
  );
};

const styles = StyleSheet.create({
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default FilePreviewModal;
