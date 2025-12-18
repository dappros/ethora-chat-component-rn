import React from "react";
import { IMessage } from "../../types/types";
import FileDownload from "../styled/UnsupportedType";
import CustomMessageImage from "../styled/MessageImage";
import CustomMessageVideo from "../styled/VideoMessage";
import AudioMessageBubble from "../styled/AudioMessageBubble";
import { Text } from "react-native";

interface MediaMessageProps {
  mimeType?: string;
  message?: IMessage;
  location?: string;
  messageText?: string;
  isUser?: boolean;
}

const MediaMessage: React.FC<MediaMessageProps> = ({
  mimeType,
  location,
  messageText,
  message,
  isUser = false,
}) => {
  if (mimeType)
    switch (true) {
      case mimeType.startsWith("image/"):
        return (
          <CustomMessageImage
            fileName={message?.fileName || "000132001"}
            fileURL={messageText || ""}
            mimetype={mimeType}
          />
        );
      case mimeType.startsWith("video/"):
        return (
          <CustomMessageVideo
            fileName={message?.fileName || "000132001"}
            fileURL={location || ""}
            mimetype={mimeType}
          />
        );
      case mimeType.startsWith("audio/") ||
        mimeType.includes("application/octet-stream"):
        const audioUrl = location || messageText || message?.locationPreview || message?.location || "";
        
        if (!audioUrl) {
          console.warn("⚠️ Audio URL is missing for audio message", {
            location,
            messageText,
            locationPreview: message?.locationPreview,
            messageLocation: message?.location,
            messageId: message?.id,
            mimetype: mimeType,
            fullMessage: message,
          });
        } else {
          console.log("✅ Audio URL found:", audioUrl);
        }
        
        return (
          <AudioMessageBubble
            audioUrl={audioUrl}
            duration={message?.duration}
            timestamp={
              message?.date
                ? new Date(message.date).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
            }
            isUser={isUser}
            waveForm={message?.waveForm as number[] | undefined}
          />
        );
      default:
        return (
          <FileDownload
            fileURL={location ? location : ""}
            fileName={location?.split("/")?.pop() || "MediaFile"}
            mimetype={mimeType}
          />
        );
    }
  return <Text>Unsupported media type</Text>;
};

export default MediaMessage;
