/** @format */

import React, { useState, useCallback, useEffect } from "react";
import {
  MessageInputContainer,
  InputContainer,
} from "./StyledInputComponents/StyledInputComponents";
import { IConfig } from "../../types/types";
import Button from "./Button";
import { SendIcon } from "../../assets/icons";

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
  editMessage,
}) => {
  const [message, setMessage] = useState("");

  const [filePreviews, setFilePreviews] = useState<File[]>([]);

  useEffect(() => {
    setMessage(editMessage || "");
  }, [editMessage]);

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
    <InputContainer>
      <MessageInputContainer>
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
                    : "#fff"
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
