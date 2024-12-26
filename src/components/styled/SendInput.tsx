/** @format */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
} from "./StyledInputComponents/StyledInputComponents";
import { IConfig } from "../../types/types";
import Button from "./Button";
import { AttachIcon, SendIcon } from "../../assets/icons";
import { TextInput } from "react-native";

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

  const [filePreviews, setFilePreviews] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMessage(editMessage || "");
  }, [editMessage]);

  const handleFocus = () => {
    onFocus?.();
  };

  const handleInputChange = useCallback((text: string) => {
    setMessage(text);
  }, []);

  const handleAttachClick = useCallback(() => {
    // if (fileInputRef.current) {
    //   fileInputRef.current.click();
    // }
  }, []);

  const handleSendClick = useCallback(
    (audioUrl?: string) => {
      if (filePreviews.length > 0) {
        console.log(filePreviews);
        console.log("Files sent:", filePreviews[0]);
        sendMedia(filePreviews[0], "media");
      } else if (audioUrl) {
        sendMedia(audioUrl, "audio");
        console.log(audioUrl);
        console.log("Audio sent:", audioUrl);
      } else {
        console.log("sending default", message);
        sendMessage(message);
      }
      setMessage("");
      setFilePreviews([]);
    },
    [filePreviews, message, sendMessage, sendMedia]
  );

  return (
    <InputContainer isText={!!message}>
      <MessageInputContainer>
        {!isRecording && (
          <>
            {!config?.disableMedia && (
              <Button
                onPress={handleAttachClick}
                disabled={false}
                EndIcon={<AttachIcon />}
              />
            )}
            <MessageInput
              isFocused={isFocused}
              color={config?.colors?.primary}
              placeholder="Type message"
              placeholderTextColor="#999"
              value={message}
              onChangeText={handleInputChange}
              onFocus={() => {
                setIsFocused(true);
                if (onFocus) onFocus();
              }}
              onBlur={() => {
                setIsFocused(false);
                if (onBlur) onBlur();
              }}
              editable={!isLoading}
            />
          </>
        )}
        {message && (
          <Button
            onPress={() => handleSendClick()}
            // disabled={!message || message === ""}
            EndIcon={
              <SendIcon
                color={
                  filePreviews.length > 0
                    ? "#fff"
                    : !message || message === ""
                    ? "#D4D4D8"
                    : "#0052CD"
                }
              />
            }
            style={{
              borderRadius: 100,
              backgroundColor:
                filePreviews.length > 0
                  ? config?.colors?.primary
                  : !message || message === ""
                  ? "transparent"
                  : config?.colors?.primary,
            }}
          />
        )}
      </MessageInputContainer>
    </InputContainer>
  );
};

export default SendInput;
