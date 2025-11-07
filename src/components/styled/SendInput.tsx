/** @format */

import React, { useState, useCallback, useEffect } from "react";
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
} from "./StyledInputComponents/StyledInputComponents";
import { IConfig, MediaFile } from "../../types/types";
import Button from "./Button";
import { SendIcon } from "../../assets/icons";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import useComposing from "../../hooks/useComposing";
import { ModalSelectMedia } from "../Modals/ModalSelectMedia/ModalSelectMedia.tsx";
import { MediaFilePreview } from "./MediaFilePreview";

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

  useComposing(message);

  console.log("filePreviews", filePreviews);

  const handleFileSelect = (files: MediaFile[]) => {
    setFilePreviews([...files]);
  };

  const handleRemoveImage = (index: number) => {
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendClick = useCallback(() => {
    if (filePreviews.length > 0) {
      filePreviews.forEach((file) => {
        sendMedia({ uri: file.uri, name: file.name }, file.type);
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
    <KeyboardAvoidingView
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
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
              <ModalSelectMedia onFileSelect={handleFileSelect} />
              <MessageInput
                isFocused={isFocused}
                color={config?.colors?.primary}
                placeholder="Type message"
                placeholderTextColor="#999"
                value={message}
                onChangeText={setMessage}
                onFocus={() => {
                  setIsFocused(true);
                }}
                onBlur={() => {
                  setIsFocused(false);
                }}
                editable={!isLoading || !isMessageProcessing}
                multiline={true}
                maxHeight={72}
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
                }}
              />
            </>
          )}
          {config?.secondarySendButton?.hideInputSendButton ? null : (
            <Button
              onPress={handleSendClick}
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
              }}
            />
          )}
        </MessageInputContainer>
        <View
          style={{
            paddingHorizontal: 16,
          }}
        ></View>
      </InputContainer>
    </KeyboardAvoidingView>
  );
};

export default SendInput;
