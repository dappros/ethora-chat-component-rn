import React, { useCallback } from 'react';
import { View, Image, TouchableOpacity } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { AttachIcon, RemoveIcon } from '../../assets/icons';
import Button from '../styled/Button';
import { IConfig } from '../../types/types';

interface FilePreview {
  uri: string;
  name: string;
  type: string;
}

interface MediaInputProps {
  filePreviews: FilePreview[];
  setFilePreviews: (
    update: FilePreview[] | ((prev: FilePreview[]) => FilePreview[])
  ) => void;
  handleSendClick: () => void;
  config?: IConfig;
}

const MediaInput: React.FC<MediaInputProps> = ({
  filePreviews,
  setFilePreviews,
  handleSendClick,
  config,
}) => {
  const handleAttachClick = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 0.8,
    });

    if (!result.canceled && result.assets) {
      const newFiles = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName || asset.uri.split('/').pop() || `file_${Date.now()}`,
        type: asset.mimeType || 'application/octet-stream',
      }));
      setFilePreviews((prevFiles: FilePreview[]) =>
        [...prevFiles, ...newFiles].slice(0, 5)
      );
    }
  }, [setFilePreviews]);

  const handleRemoveFile = useCallback(
    (file: FilePreview) => {
      setFilePreviews((prevFiles: FilePreview[]) =>
        prevFiles.filter((f) => f.uri !== file.uri)
      );
    },
    [setFilePreviews]
  );

  const renderFilePreview = useCallback((file: FilePreview) => {
    if (file.type?.startsWith('image/')) {
      return (
        <Image source={{ uri: file.uri }} style={{ width: 50, height: 50 }} />
      );
    } else if (file.type?.startsWith('video/')) {
      return (
        <Video
          source={{ uri: file.uri }}
          style={{ width: 50, height: 50 }}
          useNativeControls
          resizeMode={ResizeMode.COVER}
        />
      );
    }
    return null;
  }, []);

  return (
    <View>
      <Button
        onPress={handleAttachClick}
        disabled={config?.disableMedia}
        EndIcon={<AttachIcon />}
      />
      {filePreviews.length > 0 && (
        <View>
          {filePreviews.map((file) => (
            <View key={file.uri} style={{ position: 'relative', margin: 8 }}>
              {renderFilePreview(file)}
              <TouchableOpacity
                onPress={() => handleRemoveFile(file)}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 20,
                  height: 20,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 10,
                }}
              >
                <RemoveIcon />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

export default MediaInput;
