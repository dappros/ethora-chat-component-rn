/** @format */

import React, { useState, useCallback, useEffect } from "react";
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
} from "./StyledInputComponents/StyledInputComponents";
import { IConfig, MediaFile } from "../../types/types";
import Button from "./Button";
import { SendIcon, AttachIcon } from "../../assets/icons";
import { KeyboardAvoidingView, Platform, View, TouchableOpacity, Alert, ActionSheetIOS, Linking } from "react-native";
import { ModalSelectMedia } from "../Modals/ModalSelectMedia/ModalSelectMedia.tsx";
import { MediaFilePreview } from "./MediaFilePreview";
import DocumentPicker from "react-native-document-picker";
import ImagePicker from "react-native-image-crop-picker";
import { check, request, PERMISSIONS, RESULTS, Permission } from "react-native-permissions";

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
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [filePreviews, setFilePreviews] = useState<MediaFile[]>([]);
  const [inputHeight, setInputHeight] = useState(40);
  const [showMediaMenu, setShowMediaMenu] = useState(false);

  const handleFileSelect = (files: MediaFile[]) => {
    console.log("🔵 [SendInput] Files selected:", files);
    setFilePreviews([...files]);
  };

  const checkPermission = async (permission: Permission) => {
    const status = await check(permission);
    if (status === RESULTS.GRANTED) {
      return status;
    } else if (status === RESULTS.DENIED) {
      const requestStatus = await request(permission);
      return requestStatus;
    }
    return status;
  };

  const handleCameraSelection = async () => {
    const permission = Platform.OS === "ios" ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
    const permissionStatus = await checkPermission(permission);

    if (permissionStatus !== RESULTS.GRANTED) {
      Alert.alert("Permission required", "Camera permission is needed to take photos.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]);
      return;
    }

    try {
      const image = await ImagePicker.openCamera({
        width: 300,
        height: 400,
        cropping: true,
      });
      const file = {
        uri: image.path,
        type: image.mime,
        name: image.path.split("/").pop() || `camera_${Date.now()}.jpg`,
      };
      handleFileSelect([file]);
    } catch (error: any) {
      if (error?.code !== "E_PICKER_CANCELLED") {
        console.error("Camera error:", error);
      }
    }
  };

  const handleGallerySelection = async () => {
    try {
      let permission: Permission;
      if (Platform.OS === "ios") {
        permission = PERMISSIONS.IOS.PHOTO_LIBRARY;
      } else if (Number(Platform.Version) >= 33) {
        permission = PERMISSIONS.ANDROID.READ_MEDIA_IMAGES;
      } else {
        permission = PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
      }

      const permissionStatus = await checkPermission(permission);
      if (permissionStatus !== RESULTS.GRANTED) {
        Alert.alert("Permission required", "Gallery permission is needed to select photos.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }

      const image = await ImagePicker.openPicker({
        multiple: false,
        mediaType: "any",
      });
      const file = {
        uri: image.path,
        type: image.mime,
        name: image.path.split("/").pop() || `gallery_${Date.now()}.jpg`,
      };
      handleFileSelect([file]);
    } catch (error: any) {
      if (error?.code !== "E_PICKER_CANCELLED") {
        console.error("Gallery error:", error);
      }
    }
  };

  const handleFileSelection = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: false,
      });
      const files = result.map((file) => ({
        uri: file.uri,
        type: file.type || "unknown",
        name: file.name || `file_${Date.now()}`,
      }));
      handleFileSelect(files);
    } catch (err: any) {
      if (!DocumentPicker.isCancel(err)) {
        console.error("DocumentPicker Error:", err);
      }
    }
  };

  const handleAttachPress = () => {
    console.log("🔵 [SendInput] Attach button pressed");
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Camera", "Photo Library", "Document"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) handleCameraSelection();
          else if (buttonIndex === 2) handleGallerySelection();
          else if (buttonIndex === 3) handleFileSelection();
        }
      );
    } else {
      Alert.alert("Select Media", "Choose an option", [
        { text: "Cancel", style: "cancel" },
        { text: "Camera", onPress: handleCameraSelection },
        { text: "Photo Library", onPress: handleGallerySelection },
        { text: "Document", onPress: handleFileSelection },
      ]);
    }
  };

  const handleRemoveImage = (index: number) => {
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendClick = useCallback(() => {
    if (filePreviews.length > 0) {
      filePreviews.forEach((file) => {
        sendMedia(file, file.type);
      });
    } else if (message) {
      sendMessage(message);
    }
    setMessage("");
    setFilePreviews([]);
  }, [filePreviews, message, sendMessage, sendMedia]);

  useEffect(() => {
    setMessage(editMessage || "");
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
                    marginRight: 8,
                    width: 40,
                    height: 40,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'transparent',
                  }}
                  activeOpacity={0.7}
                >
                  <AttachIcon color={config?.colors?.primary || "#0052CD"} />
                </TouchableOpacity>
              )}
              <MessageInput
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
            onPress={handleSendClick}
            disabled={!message && filePreviews.length === 0}
            EndIcon={
              <SendIcon
                color={
                  message || filePreviews.length > 0 ? "#FFFFFF" : "#D4D4D8"
                }
              />
            }
            style={{
              borderRadius: 100,
              backgroundColor:
                message || filePreviews.length > 0
                  ? config?.colors?.primary
                  : "transparent",
              opacity: message || filePreviews.length > 0 ? 1 : 0.5,
            }}
          />
        </MessageInputContainer>
        <View
          style={{
            paddingHorizontal: 16,
          }}
        ></View>
      </InputContainer>
  );
};

export default SendInput;
