import React, { useState, useRef, useCallback } from "react";
import {
  RecordContainer,
  Timer,
} from "../styled/StyledInputComponents/StyledInputComponents";
import { RecordIcon, RemoveIcon, SendIcon } from "../../assets/icons";
import Button from "../styled/Button";
import RecordingIndicator from "./RecordingIndicator";
import { View } from "react-native";
import AudioRecorderPlayer from "react-native-audio-recorder-player";

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
  const [timer, setTimer] = useState(0);
  const [audioFilePath, setAudioFilePath] = useState<string | null>(null);
  const recorderPlayerRef = useRef(new AudioRecorderPlayer());

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  };

  const startRecording = async () => {
    setTimer(0);
    setIsRecording(true);
    try {
      const result = await recorderPlayerRef.current.startRecorder();
      recorderPlayerRef.current.addRecordBackListener((e) => {
        setTimer(Math.floor(e.currentPosition / 1000));
      });
      setAudioFilePath(result);
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  };

  const stopRecording = async () => {
    try {
      await recorderPlayerRef.current.stopRecorder();
      recorderPlayerRef.current.removeRecordBackListener();
      setIsRecording(false);
    } catch (error) {
      console.error("Error stopping recording:", error);
    }
  };

  const sendAudio = () => {
    if (audioFilePath) {
      handleSendClick(audioFilePath);
      resetState();
    }
  };

  const resetState = () => {
    setTimer(0);
    setAudioFilePath(null);
    setIsRecording(false);
  };

  return isRecording ? (
    <RecordContainer>
      <View style={{ display: "flex", alignItems: "center" }}>
        {isRecording && <RecordingIndicator />}
        <Timer>{formatTime(timer)}</Timer>
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
