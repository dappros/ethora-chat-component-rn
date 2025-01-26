import React, { useRef } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import Video, { VideoRef } from "react-native-video";
import { useDispatch } from "react-redux";
import {
  setActiveFile,
  setActiveModal,
} from "../../roomStore/chatSettingsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";

interface CustomMessageVideoProps {
  fileName: string;
  fileURL: string;
  mimetype: string;
}

const CustomMessageVideo: React.FC<CustomMessageVideoProps> = ({
  fileName,
  fileURL,
  mimetype,
}) => {
  const dispatch = useDispatch();
  const videoRef = useRef<VideoRef>(null);

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      videoRef.current.seek(0);
      // videoRef.current.presentFullscreenPlayer();
    }
  };

  return (
    <TouchableOpacity style={styles.container} onPress={handlePlayPause}>
      <Video
        ref={videoRef}
        source={{ uri: fileURL }}
        style={styles.video}
        controls
        resizeMode="contain"
        paused={true}
        onBuffer={handleOpen}
        onError={(error) => console.error("Video error:", error)}
      />
    </TouchableOpacity>
  );
};

export default CustomMessageVideo;

const styles = StyleSheet.create({
  container: {
    margin: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  video: {
    width: 300,
    height: 200,
    borderRadius: 10,
    backgroundColor: "#000", // Задаем черный фон для видео
  },
});
