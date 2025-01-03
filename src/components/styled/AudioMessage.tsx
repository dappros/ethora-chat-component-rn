import React, { useState, useRef, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import AudioRecorderPlayer from "react-native-audio-recorder-player";

interface AudioMessageProps {
  src: string;
}

const AudioMessage: React.FC<AudioMessageProps> = ({ src }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);

  const playbackRates = [1, 1.5, 2];
  const progress = useRef(new Animated.Value(0)).current;
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;

  useEffect(() => {
    audioRecorderPlayer.setSubscriptionDuration(0.1);

    audioRecorderPlayer.addPlayBackListener((e) => {
      setCurrentPosition(e.currentPosition);
      setDuration(e.duration);

      const progressValue = (e.currentPosition / e.duration) * 100;
      progress.setValue(progressValue);

      if (e.currentPosition === e.duration) {
        setIsPlaying(false);
      }
    });

    return () => {
      audioRecorderPlayer.stopPlayer();
      audioRecorderPlayer.removePlayBackListener();
    };
  }, []);

  const togglePlayPause = async () => {
    if (!isPlaying) {
      await audioRecorderPlayer.startPlayer(src);
    } else {
      await audioRecorderPlayer.pausePlayer();
    }
    setIsPlaying(!isPlaying);
  };

  const changePlaybackRate = () => {
    const nextRateIndex = (playbackRateIndex + 1) % playbackRates.length;
    setPlaybackRateIndex(nextRateIndex);

    const selectedRate = playbackRates[nextRateIndex];
    audioRecorderPlayer.setVolume(selectedRate);
  };

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <View style={styles.audioContainer}>
      <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
        <Text style={styles.playButtonText}>
          {isPlaying ? "Pause" : "Play"}
        </Text>
      </TouchableOpacity>

      <View style={styles.progressContainer}>
        <View style={styles.progressBarBackground}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: progress.interpolate({
                  inputRange: [0, 100],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.speedButton} onPress={changePlaybackRate}>
        <Text style={styles.speedButtonText}>
          {playbackRates[playbackRateIndex]}x
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default AudioMessage;

const styles = StyleSheet.create({
  audioContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#f1f1f1",
    borderRadius: 12,
    marginVertical: 8,
  },
  playButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#0052CD",
    justifyContent: "center",
    alignItems: "center",
  },
  playButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  progressContainer: {
    flex: 1,
    marginHorizontal: 10,
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: "#e0e0e0",
    borderRadius: 2,
  },
  progressBar: {
    height: 4,
    backgroundColor: "#0052CD",
    borderRadius: 2,
  },
  timeContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: "#333",
  },
  speedButton: {
    marginLeft: 10,
    padding: 5,
    borderRadius: 5,
    backgroundColor: "#0052CD",
  },
  speedButtonText: {
    color: "#fff",
    fontSize: 14,
  },
});
