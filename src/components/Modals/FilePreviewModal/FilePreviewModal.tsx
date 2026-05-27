import React, { useMemo } from 'react';
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
import { Alert, Text, View, Platform } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useToast } from '../../../context/ToastContext';
import PdfViewer from './PdfView';
import { ensureFilenameHasExtension } from '../../../helpers/mimeToExtension';

export const FullScreenVideo = styled.View`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

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
            src={
              activeFile.fileURL ||
              'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg'
            }
            alt={activeFile.fileName}
          />
        );
      case activeFile.mimetype.startsWith('video/'):
        return (
          <Video
            style={{
              width: '100%',
              height: '100%',
            }}
            source={{ uri: activeFile.fileURL }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={false}
          />
        );
      case activeFile.mimetype === 'application/pdf':
        return <PdfViewer pdfUrl={activeFile.fileURL} />;
      default: {
        const displayName = ensureFilenameHasExtension(
          activeFile.fileName,
          activeFile.mimetype
        );
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
          height: '100%',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: 16,
        }}
      >
        {getMediaComponent}
      </CenterContainer>

    </ModalContainerFullScreen>
  );
};

export default FilePreviewModal;
