import React, { FC, useMemo } from 'react';
import { Alert } from 'react-native';
import { AttachIcon, CameraIcon, DocumentIcon, MediaIcon } from '../../../assets/icons';
import Button from '../../styled/Button';
import DropdownMenu from '../../DropdownMenu/DropdownMenu';
import { launchCamera, launchImageLibrary, MediaType } from 'react-native-image-picker';
import {pick, types} from "@react-native-documents/picker";

interface MediaFile {
  uri: string;
  type: string;
  name: string;
}

interface ModalSelectMediaProps {
  onFileSelect: (files: MediaFile[]) => void;
}

export const ModalSelectMedia: FC<ModalSelectMediaProps> = ({ onFileSelect }) => {

  const handleCameraSelection = async () => {
    const options = {
      mediaType: 'photo' as MediaType,
      quality: 1,
      includeBase64: false,
      saveToPhotos: true,
    };

    try {
      const response = await launchCamera(options);

      if (response.didCancel) {
        console.log('User cancelled camera');
      } else if (response.errorCode) {
        Alert.alert('Camera Error', response.errorMessage || 'Unknown error');
      } else if (response.assets && response.assets.length > 0) {
        const file = {
          uri: response.assets[0].uri ?? '',
          type: response.assets[0].type ?? 'unknown',
          name: response.assets[0].fileName || `camera_${Date.now()}.jpg`,
        };
        onFileSelect([file]);
      }
    } catch (error) {
      console.error('Camera launch error:', error);
    }
  };


  const handleGallerySelection = async () => {
    const options = {
      mediaType: 'photo' as MediaType,
      selectionLimit: 0,
    };

    await launchImageLibrary(options, (response) => {
      if (response.didCancel) {
        console.log('User cancelled gallery');
      } else if (response.errorCode) {
        console.error('Gallery error:', response.errorMessage);
      } else if (response.assets && response.assets.length > 0) {
        const files = response.assets.map(asset => ({
          uri: asset.uri ?? '',
          type: asset.type ?? 'unknown',
          name: asset.fileName || `gallery_${Date.now()}.jpg`,
        }));
        onFileSelect(files);
      }
    });
  };

  const handleFileSelection = async () => {
    try {
      console.log('handleFileSelection 1');
      console.log('DocumentPicker pick method:', pick);
      console.log('DocumentPicker types:', types);

      const result = await pick({
        type: [types.allFiles],
        allowMultiSelection: true,
      });
      console.log('handleFileSelection 2');


      const files = result.map(file => ({
        uri: file.uri,
        type: file.type || 'unknown',
        name: file.name || `file_${Date.now()}`,
      }));
      console.log('handleFileSelection 3');

      onFileSelect(files);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        console.log('User cancelled file picker');
      } else {
        console.error('DocumentPicker Error:', err);
        Alert.alert('Error', 'Cannot open document picker');
      }
    }
  };

  const menuOptions = useMemo(
    () => [
      {
        label: "Camera",
        icon: <CameraIcon />,
        onClick: handleCameraSelection,
      },
      {
        label: "Media File",
        icon: <MediaIcon />,
        onClick: handleGallerySelection,
      },
      {
        label: "Document",
        icon: <DocumentIcon />,
        onClick: handleFileSelection,
      },
    ],
    []
  );

  return (
    <DropdownMenu
      position="leftBotom"
      options={menuOptions}
      openButton={
        <Button
          style={{ padding: 8, maxHeight: 40 }}
          EndIcon={<AttachIcon />}
          unstyled
        />
      }
    />
  );
};
