/** @format */

import React, { useState, useCallback, useEffect } from 'react';
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
} from './StyledInputComponents/StyledInputComponents';
import { IConfig, MediaFile } from '../../types/types';
import Button from './Button';
import { SendIcon, AttachIcon } from '../../assets/icons';
import { KeyboardAvoidingView, Platform, View, TouchableOpacity, Alert, ActionSheetIOS, Linking } from 'react-native';
import { ModalSelectMedia } from '../Modals/ModalSelectMedia/ModalSelectMedia.tsx';
import { MediaFilePreview } from './MediaFilePreview';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// iOS photos default to HEIC; many web backends (incl. ours) 500 on
// HEIC uploads because they can't decode it. Convert to JPEG before
// upload — JPEG is universally supported. JPEGs pass through.
const normalizeImageAsset = async (asset: ImagePicker.ImagePickerAsset) => {
  const mime = (asset.mimeType || '').toLowerCase();
  const looksLikeHeic =
    mime.includes('heic') ||
    mime.includes('heif') ||
    asset.uri.toLowerCase().endsWith('.heic') ||
    asset.uri.toLowerCase().endsWith('.heif');
  if (!looksLikeHeic) {
    return {
      uri: asset.uri,
      mime: asset.mimeType || 'image/jpeg',
      name: asset.fileName || asset.uri.split('/').pop() || `image_${Date.now()}.jpg`,
    };
  }
  const result = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const baseName = (asset.fileName || asset.uri.split('/').pop() || `image_${Date.now()}`)
    .replace(/\.(heic|heif)$/i, '.jpg');
  return { uri: result.uri, mime: 'image/jpeg', name: baseName };
};

interface SendInputProps {
  sendMessage: (message: string) => void;
  isLoading: boolean;
  editMessage?: string;
  sendMedia: (data: any, type: string) => void;
  config?: IConfig;
  onFocus?: () => void;
  onBlur?: () => void;
  isMessageProcessing?: boolean;
  formatMessage?: (text: string) => string;
  multiline?: boolean;
  inputHeight?: number;
  showPreview?: boolean;
  previewParser?: (text: string) => (string | JSX.Element)[];
}

const SendInput: React.FC<SendInputProps> = ({
  sendMessage,
  sendMedia,
  config,
  onFocus,
  onBlur,
  editMessage,
  isLoading,
  isMessageProcessing,
}) => {
  const [message, setMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [filePreviews, setFilePreviews] = useState<MediaFile[]>([]);
  const [inputHeight, setInputHeight] = useState(40);
  const [showMediaMenu, setShowMediaMenu] = useState(false);

  const handleFileSelect = (files: MediaFile[]) => {
    setFilePreviews([...files]);
  };

  // Both pickers use expo-image-picker / expo-document-picker. They
  // own permission prompts internally and surface a `canceled` flag in
  // the result — no need for a separate permissions library or hand-
  // rolled check/request flow.

  const promptOpenSettings = (message: string) => {
    Alert.alert('Permission required', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]);
  };

  const handleCameraSelection = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      promptOpenSettings('Camera permission is needed to take photos.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      const normalized = await normalizeImageAsset(asset);
      handleFileSelect([
        { uri: normalized.uri, type: normalized.mime, name: normalized.name },
      ]);
    } catch (error) {
      console.error('Camera error:', error);
    }
  };

  const handleGallerySelection = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      promptOpenSettings('Gallery permission is needed to select photos.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      // Videos pass through unchanged; only images get the HEIC→JPEG
      // normalization (manipulator is image-only).
      if (asset.type === 'video') {
        handleFileSelect([
          {
            uri: asset.uri,
            type: asset.mimeType || 'video/mp4',
            name: asset.fileName || asset.uri.split('/').pop() || `gallery_${Date.now()}.mp4`,
          },
        ]);
        return;
      }
      const normalized = await normalizeImageAsset(asset);
      handleFileSelect([
        { uri: normalized.uri, type: normalized.mime, name: normalized.name },
      ]);
    } catch (error) {
      console.error('Gallery error:', error);
    }
  };

  const handleFileSelection = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      handleFileSelect([
        {
          uri: asset.uri,
          type: asset.mimeType || 'application/octet-stream',
          name: asset.name || `file_${Date.now()}`,
        },
      ]);
    } catch (err) {
      console.error('DocumentPicker error:', err);
    }
  };

  const handleAttachPress = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Camera', 'Photo Library', 'Document'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {handleCameraSelection();}
          else if (buttonIndex === 2) {handleGallerySelection();}
          else if (buttonIndex === 3) {handleFileSelection();}
        }
      );
    } else {
      Alert.alert('Select Media', 'Choose an option', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Camera', onPress: handleCameraSelection },
        { text: 'Photo Library', onPress: handleGallerySelection },
        { text: 'Document', onPress: handleFileSelection },
      ]);
    }
  };

  const handleRemoveImage = (index: number) => {
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendClick = useCallback(async () => {
    const filesToSend = filePreviews;
    const messageToSend = message;
    setMessage('');
    setFilePreviews([]);

    for (const file of filesToSend) {
      try {
        await sendMedia(file, file.type);
      } catch (err) {
        console.error(err);
        return;
      }
    }
    if (messageToSend) {
      sendMessage(messageToSend);
    }
  }, [filePreviews, message, sendMessage, sendMedia]);

  useEffect(() => {
    setMessage(editMessage || '');
  }, [editMessage]);

  return (
    <InputContainer isText={!!message}>
        {filePreviews.length > 0 && (
          <MediaFilePreview
            filePreviews={filePreviews}
            handleRemoveImage={handleRemoveImage}
          />
        )}
        <MessageInputContainer>
          {!isRecording && (
            <>
              {/* Media selection button - always visible on the left, unless disabled in config */}
              {!config?.disableMedia && (
                <TouchableOpacity
                  onPress={handleAttachPress}
                  style={{
                    width: 40,
                    height: 40,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'transparent',
                  }}
                  activeOpacity={0.7}
                >
                  <AttachIcon color={config?.colors?.primary || '#0052CD'} />
                </TouchableOpacity>
              )}
              <MessageInput
                // Stable testIDs so Maestro / Detox / Appium can drive
                // the chat-send flow reliably. accessibilityLabel
                // mirrors the testID so iOS accessibility-id lookups
                // also work. (TextInput in src/components/InputComponents
                // also carries the same testIDs as a fallback, but
                // SendInput is the input that actually ships in
                // <ChatRoom> / <Thread> so this is the one e2e drivers
                // hit in practice.)
                testID="chat-message-input"
                accessibilityLabel="chat-message-input"
                isFocused={isFocused}
                color={config?.colors?.primary}
                placeholder="Type message"
                placeholderTextColor="#999"
                value={message}
                onChangeText={setMessage}
                onFocus={() => {
                  onFocus?.();
                  setIsFocused(true);
                }}
                onBlur={() => {
                  onBlur?.();
                  setIsFocused(false);
                }}
                editable={!isLoading || !isMessageProcessing}
                multiline={true}
                // maxHeight={72}
                onContentSizeChange={(event) => {
                  setInputHeight(
                    Math.min(
                      72,
                      Math.max(40, event.nativeEvent.contentSize.height)
                    )
                  );
                }}
                style={{
                  height: inputHeight,
                  flex: 1,
                }}
              />
            </>
          )}
          {/* Always show send button - it's needed for sending messages and media */}
          <Button
            testID="chat-send-button"
            accessibilityLabel="chat-send-button"
            onPress={handleSendClick}
            disabled={!message && filePreviews.length === 0}
            EndIcon={
              <SendIcon
                color={
                  message || filePreviews.length > 0 ? '#FFFFFF' : '#D4D4D8'
                }
              />
            }
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                message || filePreviews.length > 0
                  ? config?.colors?.primary
                  : 'transparent',
              opacity: message || filePreviews.length > 0 ? 1 : 0.5,
            }}
          />
        </MessageInputContainer>
      </InputContainer>
  );
};

export default SendInput;
