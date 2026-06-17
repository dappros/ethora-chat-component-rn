import React from 'react';

import {
  BackgroundFile,
  FileInformation,
  FileName,
  FileSize,
  FileSizeContainer,
  UnsupportedContainer,
} from './StyledInputComponents/MediaComponents';
import { useDispatch } from 'react-redux';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import {
  setActiveFile,
  setActiveModal,
} from '../../roomStore/chatSettingsSlice';
import { ActivityIndicator, View } from 'react-native';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { FileIcon } from '../../assets/icons';
import { getExtensionForMime } from '../../helpers/mimeToExtension';

interface FileDownloadProps {
  fileName: string;
  fileURL: string;
  mimetype: string;
  size?: string;
  isUser: boolean;
  originalName?: string;
  duration?: number | string;
  waveForm?: string;
  pending?: boolean;
  placeholderIcon?: React.ReactNode;
}

const FileDownload: React.FC<FileDownloadProps> = ({
  fileName,
  fileURL,
  mimetype,
  size,
  isUser,
  originalName,
  duration,
  waveForm,
  pending = false,
  placeholderIcon,
}) => {
  const dispatch = useDispatch();
  const { config } = useChatSettingState();

  const formatFileSize = (sizeInBytes: string): string => {
    const size = parseInt(sizeInBytes, 10);

    if (isNaN(size)) {
      return 'Invalid size';
    }

    if (size < 1024) {
      return `${size} B`;
    } else if (size < 1024 ** 2) {
      return `${(size / 1024).toFixed(2)} KB`;
    } else if (size < 1024 ** 3) {
      return `${(size / 1024 ** 2).toFixed(2)} MB`;
    } else {
      return `${(size / 1024 ** 3).toFixed(2)} GB`;
    }
  };

  const formatFileName = (name: string, maxLength: number): string => {
    const dotIndex = name.lastIndexOf('.');
    const extension = dotIndex !== -1 ? name.substring(dotIndex) : '';

    const baseName = dotIndex !== -1 ? name.substring(0, dotIndex) : name;

    if (baseName.length + extension.length <= maxLength) {
      return name;
    }

    const shortenedBaseName = baseName.substring(
      0,
      maxLength - extension.length - 3
    );

    return `${shortenedBaseName}...${extension}`;
  };

  const handleOpen = () => {
    if (!fileURL || pending) {
      return;
    }
    dispatch(
      setActiveFile({
        fileName,
        fileURL,
        mimetype,
        originalName,
        duration,
        waveForm,
      })
    );
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  const extensionLabel = (() => {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex !== -1 && dotIndex < fileName.length - 1) {
      return fileName.slice(dotIndex + 1).toUpperCase();
    }
    return getExtensionForMime(mimetype).replace('.', '').toUpperCase();
  })();

  return (
    <UnsupportedContainer
      testID="message-media-file"
      accessibilityLabel="message-media-file"
      isUser={isUser}
      onPress={handleOpen}
      activeOpacity={pending ? 1 : 0.7}
    >
      <BackgroundFile>
        {placeholderIcon || <FileIcon width={36} height={36} />}
      </BackgroundFile>
      <FileInformation>
        <FileName
          numberOfLines={1}
          isUser={isUser}
          colorIsUser={config?.colors?.primary}
          colorUsers={config?.colors?.secondary}
        >{formatFileName(fileName, 20)}</FileName>
        {(pending || size) && (
          <FileSizeContainer>
            {pending ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ActivityIndicator size="small" color="#5B6B8C" />
                <FileSize>Uploading...</FileSize>
              </View>
            ) : (
              <FileSize>{formatFileSize(size as string)}</FileSize>
            )}
          </FileSizeContainer>
        )}
        {!pending && !size && (
          <FileSizeContainer>
            <FileSize>{extensionLabel}</FileSize>
          </FileSizeContainer>
        )}
      </FileInformation>
    </UnsupportedContainer>
  );
};

export default FileDownload;
