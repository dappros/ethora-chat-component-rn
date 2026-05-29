import React, { useEffect, useState } from 'react';
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
import { useVideoPlayer, VideoView } from 'expo-video';
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

// Full-screen video preview on expo-video (expo-av <Video> is deprecated
// and rendered blank on Android). `contentFit: contain` fits the clip to
// the area with the surrounding letterbox painted as the view's own
// (transparent → theme) background, NOT black. `textureView` so the play
// overlay composites on top and nothing is clipped on Android.
const ModalVideo: React.FC<{ uri: string }> = ({ uri }) => {
  const [showPlay, setShowPlay] = useState(true);

  const player = useVideoPlayer(uri, (p) => {
    p.muted = false;
  });

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) {setShowPlay(false);}
    });
    return () => sub.remove();
  }, [player]);

  const handlePlay = () => {
    setShowPlay(false);
    player.play();
  };

  return (
    <View style={{ flex: 1, width: '100%' }}>
      <VideoView
        player={player}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentFit="contain"
        nativeControls
        surfaceType="textureView"
        allowsFullscreen
      />
      {/* Play affordance shown immediately on open; tapping starts
          playback and the native controls take over. */}
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

  if (!activeFile) {return null;}

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

  // NOTE: plain computed value, NOT useMemo. It sits AFTER the
  // `if (!activeFile) return` guard above, so as a hook it would run
  // conditionally (skipped when activeFile is null) — changing the hook
  // count between renders and throwing "rendered more hooks than during
  // the previous render", which crashed the modal the instant you tapped
  // a video/image to open it. Recomputing this on each render is cheap.
  const getMediaComponent: React.ReactNode = (() => {
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
  })();

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
          // NOTE: do NOT set overflow:'hidden' here — on Android it clips
          // hardware-accelerated children (expo-av Video TextureView and
          // react-native-webview) to nothing, so video/PDF/doc previews
          // render blank while plain <Image> survives.
          overflow: 'visible',
          padding: 16,
          paddingBottom: 48,
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
