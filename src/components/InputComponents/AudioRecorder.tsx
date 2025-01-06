import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  RecordContainer,
  Timer,
} from "../styled/StyledInputComponents/StyledInputComponents";
import { RecordIcon, RemoveIcon, SendIcon } from "../../assets/icons";
import Button from "../styled/Button";
import RecordingIndicator from "./RecordingIndicator";
import { Platform, View } from "react-native";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import RNFS from "react-native-fs";

interface AudioRecorderProps {
  setIsRecording: (state: boolean) => void;
  isRecording: boolean;
  handleSendClick: (audioBlob?: any) => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  setIsRecording,
  isRecording,
  handleSendClick,
}) => {
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const [timer, setTimer] = useState("00:00");
  const [audioPath, setAudioPath] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
    };
  }, [audioRecorderPlayer]);

  const startRecording = async () => {
    try {
      const path = Platform.select({
        ios: `${RNFS.DocumentDirectoryPath}/recording.m4a`,
        android: `${RNFS.CachesDirectoryPath}/recording.mp4`,
      });
      const uri = await audioRecorderPlayer.startRecorder(path);
      setAudioPath(uri);

      audioRecorderPlayer.addRecordBackListener((e) => {
        const minutes = Math.floor(e.currentPosition / 60000);
        const seconds = Math.floor((e.currentPosition % 60000) / 1000);
        setTimer(
          `${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`
        );
      });

      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
      setIsRecording(false);
    } catch (error) {
      console.error("Error stopping recording:", error);
    }
  };

  const sendAudio = () => {
    if (audioPath) {
      console.log("Audio sent:", audioPath);
      handleSendClick(audioPath);
      resetState();
    }
  };

  const resetState = () => {
    setAudioPath(null);
    setTimer("00:00");
    setIsRecording(false);
  };
  return isRecording ? (
    <RecordContainer>
      <View style={{ display: "flex", alignItems: "center" }}>
        {isRecording && <RecordingIndicator />}
        <Timer>{timer}</Timer>
      </View>

      <View style={{ display: "flex", gap: 8 }}>
        <Button onPress={stopRecording} EndIcon={<RemoveIcon />} unstyled />
        <Button onPress={sendAudio} EndIcon={<SendIcon />} unstyled />
      </View>
    </RecordContainer>
  ) : (
    <Button onPress={startRecording} EndIcon={<RecordIcon />} />
  );
};

export default AudioRecorder;
