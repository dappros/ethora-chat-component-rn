/** @format */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
} from './StyledInputComponents/StyledInputComponents';
import { IConfig, MediaFile } from '../../types/types';
import Button from './Button';
import { SendIcon, AttachIcon } from '../../assets/icons';
import { KeyboardAvoidingView, Platform, View, TouchableOpacity, Alert, ActionSheetIOS, Linking } from 'react-native';
import AttachSheet from '../Modals/AttachSheet/AttachSheet';
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

  // Refs shadow `message` and `filePreviews` so handleSendClick can:
  //   (a) read the LATEST typed value even when React state hasn't
  //       flushed yet (rapid tap-burst race),
  //   (b) clear the ref SYNCHRONOUSLY before any await — so a follow-up
  //       tap on send that happens before the next render reads `''`
  //       and bails out (instead of re-sending the same content).
  // Without these, fast spam-typing+sending used to collapse 10 user
  // sends into 1 server message with all 10 contents stacked.
  const messageRef = useRef(message);
  const filePreviewsRef = useRef<MediaFile[]>(filePreviews);
  // Guard flag so a 2nd tap during the first send's await is a no-op
  // (versus duplicating the send with stale closure state).
  const sendingRef = useRef(false);

  const handleFileSelect = (files: MediaFile[]) => {
    filePreviewsRef.current = files;
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
      promptOpenSettings('Camera permission is needed to take photos and videos.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.9,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      if (asset.type === 'video') {
        handleFileSelect([
          {
            uri: asset.uri,
            type: asset.mimeType || 'video/mp4',
            name: asset.fileName || asset.uri.split('/').pop() || `camera_${Date.now()}.mp4`,
          },
        ]);
        return;
      }
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
      promptOpenSettings('Gallery permission is needed to select photos and videos.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.9,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
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
      setShowMediaMenu(true);
    }
  };

  const handleRemoveImage = (index: number) => {
    const next = filePreviewsRef.current.filter((_, i) => i !== index);
    filePreviewsRef.current = next;
    setFilePreviews(next);
  };

  const handleSendClick = useCallback(async () => {
    // Snapshot LATEST values from refs, not from the React-state
    // closure. The closure is captured at render-time and may be
    // stale by the time a fast-fingered user spams the send button.
    const messageToSend = messageRef.current;
    const filesToSend = filePreviewsRef.current;

    // Nothing to send → bail. Critical for the spam case: after the
    // first tap clears refs, subsequent taps queued by RN's native
    // gesture system see empty refs and exit without re-sending.
    if (!messageToSend && filesToSend.length === 0) {return;}

    // Re-entrancy guard. If a previous send is still awaiting upload
    // / xmpp.send, a second tap should NOT slip through with the
    // same snapshotted content.
    if (sendingRef.current) {return;}
    sendingRef.current = true;

    // CLEAR EVERYTHING SYNCHRONOUSLY — refs first (so the early-bail
    // above catches the next rapid tap immediately), then dispatch
    // state updates so the UI catches up on the next render.
    messageRef.current = '';
    filePreviewsRef.current = [];
    setMessage('');
    setFilePreviews([]);

    try {
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
    } finally {
      sendingRef.current = false;
    }
    // Deps intentionally exclude `message` / `filePreviews` — we read
    // from refs, so closure freshness is irrelevant and re-creating
    // the handler on every keystroke would just thrash GC + risk the
    // (still-async) `disabled` button race.
  }, [sendMessage, sendMedia]);

  useEffect(() => {
    const next = editMessage || '';
    messageRef.current = next;
    setMessage(next);
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
                onChangeText={(text) => {
                  // Mirror into the ref synchronously so handleSendClick
                  // reads the latest value even before the React state
                  // commit lands (the source of the spam-merge bug).
                  messageRef.current = text;
                  setMessage(text);
                }}
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
        <AttachSheet
          visible={showMediaMenu}
          onClose={() => setShowMediaMenu(false)}
          onCamera={handleCameraSelection}
          onGallery={handleGallerySelection}
          onDocument={handleFileSelection}
          primaryColor={config?.colors?.primary}
        />
      </InputContainer>
  );
};

export default SendInput;
