import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components/native';
import {
  CenterContainer,
  ModalContainerFullScreen,
} from '../styledModalComponents';
import { SaveIcon } from '../../../assets/icons';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { chatTextStyle } from '../../../helpers/typography';
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
  Share,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { PlayIcon } from '../../../assets/icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useToast } from '../../../context/ToastContext';
import PdfViewer from './PdfView';
import DocumentViewer from './DocumentViewer';
import AudioMessage from '../../styled/AudioMessage';
import { ensureFilenameHasExtension, isLikelyAudio } from '../../../helpers/mimeToExtension';

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

// Full-screen video preview on expo-video (the discontinued expo-av
// <Video> rendered blank on Android). `contentFit: contain` fits the clip to
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
        // Fullscreen stays available by default on both expo-video lines:
        // `allowsFullscreen` (SDK 54, default true) was replaced by
        // `fullscreenOptions.enable` (SDK 57, default true). Passing neither
        // keeps this file compiling against both.
      />
      {/* Play affordance shown immediately on open; tapping starts
          playback and the native controls take over. */}
      {showPlay && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePlay}
          style={StyleSheet.absoluteFill}
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
  const { config } = useChatSettingState();

  // Cache the SAF directory the user granted so saving several documents
  // in a row doesn't re-prompt for a folder every time (Android only).
  const safDirUriRef = useRef<string | null>(null);

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
      const fileName = ensureFilenameHasExtension(
        activeFile.fileName,
        activeFile.mimetype
      );
      const filePath = FileSystem.cacheDirectory + fileName;
      const download = await FileSystem.downloadAsync(activeFile.fileURL, filePath);

      if (download.status !== 200) {
        Alert.alert('Error', 'Failed to save the file.');
        return;
      }

      if (Platform.OS === 'android') {
        const saf = (FileSystem as any).StorageAccessFramework;
        let dirUri = safDirUriRef.current;
        if (!dirUri) {
          const perm = await saf.requestDirectoryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert(
              'Permission Denied',
              'Storage permission is required to save the file.'
            );
            return;
          }
          dirUri = perm.directoryUri;
          safDirUriRef.current = dirUri;
        }

        const baseName = fileName.replace(/\.[^/.]+$/, '');
        const mime = activeFile.mimetype || 'application/octet-stream';
        const base64 = await FileSystem.readAsStringAsync(download.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const destUri = await saf.createFileAsync(dirUri, baseName, mime);
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        showToast({
          id: Date.now().toString(),
          title: 'Success',
          message: 'Save successful',
          type: 'success',
        });
        return;
      }

      // iOS (and any non-Android): there is no app-writable "Downloads"
      // folder, and MediaLibrary only accepts images/videos — which is why
      // documents previously hit the success toast without ever being
      // saved. Present the system share sheet so the user can "Save to
      // Files", AirDrop, etc. The sheet itself is the confirmation (the
      // user may cancel), so we don't show a "Save successful" toast here.
      await Share.share({
        url: download.uri,
        title: fileName,
      });
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
      case activeFile.mimetype.includes('application/octet-stream'):
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
              Voice message
            </Text>
            <AudioMessage
              src={activeFile.fileURL}
              mimeType={activeFile.mimetype}
              fileName={activeFile.fileName}
              originalName={activeFile.originalName}
              duration={activeFile.duration}
              waveForm={activeFile.waveForm}
            />
          </View>
        );
      // Mirrors the MediaMessage heuristic: treat octet-stream voicemails
      // with audio-shaped filenames / URLs as audio so the preview shows
      // the player instead of an "Unsupported" card. Customer-reported
      // #9 voicemail fix — see isLikelyAudio in mimeToExtension.ts.
      case isLikelyAudio(
        activeFile.mimetype,
        activeFile.fileName,
        activeFile.fileURL,
        {
          duration: activeFile.duration,
          waveForm: activeFile.waveForm,
          originalName: activeFile.originalName,
        }
      ):
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
                activeFile.originalName || activeFile.fileName,
                activeFile.mimetype
              )}
            </Text>
            <AudioMessage
              src={activeFile.fileURL}
              mimeType={activeFile.mimetype}
              fileName={activeFile.fileName}
              originalName={activeFile.originalName}
              duration={activeFile.duration}
              waveForm={activeFile.waveForm}
            />
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
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
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
          // hardware-accelerated children (expo-video TextureView and
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
    ...StyleSheet.absoluteFill,
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
