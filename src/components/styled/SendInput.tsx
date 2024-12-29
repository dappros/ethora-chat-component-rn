/** @format */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
  MediaContainer,
  MediaImage,
} from "./StyledInputComponents/StyledInputComponents";
import { IConfig } from "../../types/types";
import Button from "./Button";
import { AttachIcon, SendIcon } from "../../assets/icons";
import { Image, TextInput, TouchableOpacity, View } from "react-native";
import AudioRecorder from "../InputComponents/AudioRecorder";
import {
  launchImageLibrary,
  launchCamera,
  ImageLibraryOptions,
} from "react-native-image-picker";
import { RemoveButton, RemoveButtonText } from "./StyledComponents";

interface MediaFile {
  uri: string;
  type: string;
  name: string;
}

interface SendInputProps {
  sendMessage: (message: string) => void;
  isLoading: boolean;
  editMessage?: string;
  sendMedia: (data: any, type: string) => void;
  config?: IConfig;
  onFocus?: () => void;
  onBlur?: () => void;
}

const SendInput: React.FC<SendInputProps> = ({
  sendMessage,
  sendMedia,
  config,
  onFocus,
  onBlur,
  editMessage,
  isLoading,
}) => {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [filePreviews, setFilePreviews] = useState<MediaFile[]>([]);

  const handleRemoveImage = (index: number) => {
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAttachClick = useCallback(async () => {
    const options: ImageLibraryOptions = {
      mediaType: "mixed",
      selectionLimit: 5,
    };

    try {
      const result = await launchImageLibrary(options);

      if (result.didCancel) {
        console.log("User cancelled image picker");
      } else if (result.errorCode) {
        console.error("ImagePicker Error:", result.errorMessage);
      } else if (result.assets && result.assets.length > 0) {
        setFilePreviews((prev) => {
          const remainingSlots = 5 - prev.length;
          if (remainingSlots <= 0) {
            console.log("Maximum file limit reached.");
            return prev;
          }

          const selectedFiles = result
            .assets!.slice(0, remainingSlots)
            .map((asset) => ({
              uri: asset.uri || "",
              type: asset.type || "unknown",
              name: asset.fileName || `file_${Date.now()}`,
            }));

          return [...prev, ...selectedFiles];
        });
      }
    } catch (error) {
      console.error("Error selecting media:", error);
    }
  }, []);

  const handleSendClick = useCallback(() => {
    if (filePreviews.length > 0) {
      filePreviews.forEach((file) => {
        sendMedia(file, file.type.startsWith("image") ? "image" : "video");
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
    <InputContainer>
      {filePreviews.length > 0 && (
        <MediaContainer>
          {filePreviews.map((file, index) => (
            <View>
              <MediaImage key={index} source={{ uri: file.uri }} />
              <RemoveButton onPress={() => handleRemoveImage(index)}>
                <RemoveButtonText>&times;</RemoveButtonText>
              </RemoveButton>
            </View>
          ))}
        </MediaContainer>
      )}
      <MessageInputContainer>
        {!isRecording && (
          <>
            <Button
              onPress={handleAttachClick}
              disabled={false}
              EndIcon={<AttachIcon />}
            />
            <MessageInput
              isFocused={isFocused}
              color={config?.colors?.primary}
              placeholder="Type message"
              placeholderTextColor="#999"
              value={message}
              onChangeText={setMessage}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              editable={!isLoading}
            />
          </>
        )}
        {message || filePreviews.length > 0 || config?.disableMedia ? (
          <Button
            onPress={handleSendClick}
            EndIcon={<SendIcon color={message ? "#0052CD" : "#D4D4D8"} />}
            style={{
              borderRadius: 100,
              backgroundColor: message
                ? config?.colors?.primary
                : "transparent",
            }}
          />
        ) : (
          <AudioRecorder
            setIsRecording={setIsRecording}
            isRecording={isRecording}
            handleSendClick={handleSendClick}
          />
        )}
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
