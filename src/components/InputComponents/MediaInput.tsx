import React, { useCallback } from 'react';
import { View, Image, TouchableOpacity } from 'react-native';
import Video from 'react-native-video';
import { AttachIcon, RemoveIcon } from '../../assets/icons';
import Button from '../styled/Button';
import { launchImageLibrary } from 'react-native-image-picker';
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
  const handleAttachClick = useCallback(() => {
    launchImageLibrary(
      {
        mediaType: 'mixed',
        selectionLimit: 5,
      },
      (response) => {
        if (response.assets) {
          const newFiles = response.assets.map((asset) => ({
            uri: asset.uri!,
            name: asset.fileName!,
            type: asset.type!,
          }));
          setFilePreviews((prevFiles: FilePreview[]) =>
            [...prevFiles, ...newFiles].slice(0, 5)
          );
        }
      }
    );
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
          controls
          resizeMode="cover"
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
