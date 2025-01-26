import React from "react";
import { IMessage } from "../../types/types";
import FileDownload from "../styled/UnsupportedType";
import CustomMessageImage from "../styled/MessageImage";
import CustomMessageVideo from "../styled/VideoMessage";
import AudioMessage from "../styled/AudioMessage";
import { Text } from "react-native";

interface MediaMessageProps {
  mimeType?: string;
  message?: IMessage;
  location?: string;
  messageText?: string;
}

const MediaMessage: React.FC<MediaMessageProps> = ({
  mimeType,
  location,
  messageText,
  message,
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
        return <AudioMessage src={location || ""} />;
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
