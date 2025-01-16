import React, { useEffect, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
} from "react-native";
import { FFmpegKit, ReturnCode } from "ffmpeg-kit-react-native";
import RNFetchBlob from "rn-fetch-blob";

const AudioMessage = ({ src }: { src: string }) => {
  const [amplitudes, setAmplitudes] = useState<number[]>([]);

  const fetchAndConvertAudio = async (url: string) => {
    try {
      const res = await RNFetchBlob.config({ fileCache: true }).fetch(
        "GET",
        url
      );

      console.log("res---!!!", res);
      const audioPath = res.path();
      console.log("Audio file downloaded to:", audioPath);

      const pcmPath = `${RNFetchBlob.fs.dirs.CacheDir}/audio.pcm`;

      await FFmpegKit.executeAsync(
        `-i ${audioPath} -f s16le -ar 44100 -ac 1 ${pcmPath}`,
        async (session) => {
          const returnCode = await session.getReturnCode();
          if (ReturnCode.isSuccess(returnCode)) {
            const pcmData = await RNFetchBlob.fs.readFile(pcmPath, "ascii");
            const amplitudes = pcmData
              .split("")
              .map((char) => char.charCodeAt(0));
            setAmplitudes(amplitudes.slice(0, 100)); // Ограничиваем количество баров
          } else {
            console.error("FFmpeg execution failed.");
          }
        }
      );
    } catch (error) {
      console.error("Error processing audio file:", error);
    }
  };

  useEffect(() => {
    fetchAndConvertAudio(src);
  }, [src]);

  return (
    <ScrollView horizontal contentContainerStyle={styles.waveformContainer}>
      {amplitudes.map((amplitude, index) => (
        <View
          key={index}
          style={[
            styles.waveBar,
            {
              height: Math.max(amplitude, 1) * 2,
            },
          ]}
        />
      ))}
    </ScrollView>
  );
};

export default AudioMessage;

const styles = StyleSheet.create({
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5,
  },
  waveBar: {
    width: 4,
    backgroundColor: "#007AFF",
    marginHorizontal: 1,
    borderRadius: 2,
  },
});
