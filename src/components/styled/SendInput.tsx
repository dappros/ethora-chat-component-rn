/** @format */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
  RecordContainer,
  Timer,
} from "./StyledInputComponents/StyledInputComponents";
import { IConfig, MediaFile } from "../../types/types";
import Button from "./Button";
import { SendIcon, RecordIcon, RemoveIcon } from "../../assets/icons";
import { KeyboardAvoidingView, Platform, View, Alert, Linking } from "react-native";
import { ModalSelectMedia } from "../Modals/ModalSelectMedia/ModalSelectMedia.tsx";
import { MediaFilePreview } from "./MediaFilePreview";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import RNFS from "react-native-fs";
import RecordingIndicator from "../InputComponents/RecordingIndicator";
import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  Permission,
} from "react-native-permissions";

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
  const [recordingTimer, setRecordingTimer] = useState("00:00");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;

  useEffect(() => {
    return () => {
      if (isRecording) {
        audioRecorderPlayer.stopRecorder();
        audioRecorderPlayer.removeRecordBackListener();
      }
    };
  }, [isRecording, audioRecorderPlayer]);

  const handleFileSelect = (files: MediaFile[]) => {
    setFilePreviews([...files]);
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

  const requestMicrophonePermission = async (): Promise<boolean> => {
    try {
      const permission: Permission =
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.MICROPHONE
          : PERMISSIONS.ANDROID.RECORD_AUDIO;

      const status = await check(permission);

      if (status === RESULTS.GRANTED) {
        return true;
      }

      if (status === RESULTS.DENIED) {
        const requestStatus = await request(permission);
        if (requestStatus === RESULTS.GRANTED) {
          return true;
        }
      }

      if (status === RESULTS.BLOCKED || status === RESULTS.UNAVAILABLE) {
        Alert.alert(
          "Permission required",
          "To record audio messages, you need to grant permission to use the microphone.",
          [
            {
              text: "Cancel",
              style: "cancel",
            },
            {
              text: "Open settings",
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      }

      return false;
    } catch (error) {
      console.error("Error requesting microphone permission:", error);
      return false;
    }
  };

  const startRecording = async () => {
    try {
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        console.log("Microphone permission denied");
        return;
      }

      audioRecorderPlayer.setSubscriptionDuration(0.1);

      const timestamp = Date.now();
      const fileName = `recording_${timestamp}.${Platform.OS === "ios" ? "m4a" : "mp4"}`;
      const directory = Platform.select({
        ios: RNFS.DocumentDirectoryPath,
        android: RNFS.CachesDirectoryPath,
      });
      
      if (!directory) {
        throw new Error("Directory path is undefined");
      }
      
      const dirExists = await RNFS.exists(directory);
      if (!dirExists) {
        await RNFS.mkdir(directory);
      }

      const path = `${directory}/${fileName}`;
      
      console.log("Starting recording to path:", path);
      
      let uri: string;
      if (Platform.OS === "ios") {
        uri = await audioRecorderPlayer.startRecorder(path);
      } else {
        const audioSetAndroid = {
          AudioEncoderAndroid: 3, // AudioEncoderAndroid.AAC
          AudioSourceAndroid: 1, // AudioSourceAndroid.MIC
        };
        uri = await audioRecorderPlayer.startRecorder(path, audioSetAndroid);
      }
      console.log("Recording started, URI:", uri);
      
      setAudioPath(uri);

      audioRecorderPlayer.addRecordBackListener((e) => {
        const minutes = Math.floor(e.currentPosition / 60000);
        const seconds = Math.floor((e.currentPosition % 60000) / 1000);
        setRecordingTimer(
          `${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`
        );
      });

      setIsRecording(true);
    } catch (error: any) {
      console.error("Error starting recording:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      
      const errorMessage = error?.message || String(error);
      const isSimulatorError = 
        errorMessage.includes("simulator") || 
        errorMessage.includes("Error occured during initiating recorder") ||
        errorMessage.includes("microphone") && Platform.OS === "ios";
      
      let alertMessage = "Failed to start recording audio.";
      if (error?.message) {
        alertMessage += `\n${error.message}`;
      }
      
      if (isSimulatorError && Platform.OS === "ios") {
        Alert.alert(
          "Microphone not available",
          "Microphone not working on iOS simulator. Please test on a real device.",
          [{ text: "OK" }]
        );
      } else {
        Alert.alert(
          "Recording error",
          alertMessage + "\n\nCheck:\n- Application permissions\n- Microphone availability\n- Try on a real device",
          [{ text: "OK" }]
        );
      }
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
      setIsRecording(false);
      setRecordingTimer("00:00");
      setAudioPath(null);
    } catch (error) {
      console.error("Error stopping recording:", error);
    }
  };

  const sendAudio = async () => {
    if (audioPath) {
      try {
        // Проверяем, что файл существует
        const fileExists = await RNFS.exists(audioPath);
        if (!fileExists) {
          console.error("Audio file does not exist:", audioPath);
          Alert.alert("Error", "Audio file not found. Please try recording again.");
          await stopRecording();
          return;
        }

        // Получаем информацию о файле
        const fileInfo = await RNFS.stat(audioPath);
        
        const audioFile: MediaFile = {
          uri: audioPath,
          type: Platform.select({
            ios: "audio/m4a",
            android: "audio/mp4",
          }) || "audio/m4a",
          name: `recording_${Date.now()}.${Platform.OS === "ios" ? "m4a" : "mp4"}`,
          size: fileInfo.size || 0,
        };
        
        console.log("🎤 Sending audio file:", {
          uri: audioFile.uri,
          type: audioFile.type,
          name: audioFile.name,
          size: audioFile.size,
        });
        
        sendMedia(audioFile, audioFile.type);
        
        await stopRecording();
      } catch (error) {
        console.error("Error sending audio:", error);
        Alert.alert("Error", "Failed to send audio message. Please try again.");
        await stopRecording();
      }
    }
  };

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
          {isRecording ? (
            <RecordContainer>
              <View style={{ display: "flex", alignItems: "center", flex: 1 }}>
                {isRecording && <RecordingIndicator />}
                <Timer>{recordingTimer}</Timer>
              </View>
               <View style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Button 
                  onPress={stopRecording} 
                  EndIcon={<RemoveIcon />}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "#FF3B30",
                    margin: 0,
                    padding: 0,
                  }}
                />
                <Button 
                  onPress={sendAudio} 
                  EndIcon={<SendIcon color="#FFFFFF" />}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: config?.colors?.primary || "#5E3FDE",
                    margin: 0,
                    padding: 0,
                  }}
                />
              </View>
            </RecordContainer>
          ) : (
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
                }}
              />
          {config?.secondarySendButton?.hideInputSendButton ? null : (
            <Button
                  onPress={
                    message || filePreviews.length > 0
                      ? handleSendClick
                      : startRecording
                  }
              EndIcon={
                    message || filePreviews.length > 0 ? (
                <SendIcon
                  color={
                          message || filePreviews.length > 0
                            ? "#FFFFFF"
                            : "#D4D4D8"
                  }
                />
                    ) : (
                      <RecordIcon />
                    )
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
            </>
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
