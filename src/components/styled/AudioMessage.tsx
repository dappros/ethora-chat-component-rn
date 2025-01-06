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
  const playbackRates = [1, 1.5, 2];
  const [playbackRateIndex, setPlaybackRateIndex] = useState(0);

  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const waveAnimation = useRef(new Animated.Value(0)).current;

  const waveHeights = [10, 20, 15, 25, 18, 12, 20, 15, 25, 10, 18, 22, 14];

  useEffect(() => {
    audioRecorderPlayer.setSubscriptionDuration(0.1);

    audioRecorderPlayer.addPlayBackListener((e) => {
      setCurrentPosition(e.currentPosition);
      setDuration(e.duration);

      if (e.currentPosition === e.duration) {
        setIsPlaying(false);
        stopWaveAnimation();
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
      startWaveAnimation();
    } else {
      await audioRecorderPlayer.pausePlayer();
      stopWaveAnimation();
    }
    setIsPlaying(!isPlaying);
  };

  const startWaveAnimation = () => {
    Animated.loop(
      Animated.timing(waveAnimation, {
        toValue: 1,
        duration: 500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  };

  const stopWaveAnimation = () => {
    waveAnimation.stopAnimation();
  };

  const changePlaybackRate = () => {
    const nextRateIndex = (playbackRateIndex + 1) % playbackRates.length;
    setPlaybackRateIndex(nextRateIndex);
  };

  console.log("src", src);
  console.log("currentPosition", currentPosition);
  console.log("duration", duration);

  return (
    <View style={styles.audioContainer}>
      <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
        <Text style={styles.playButtonText}>{isPlaying ? "❚❚" : "▶"}</Text>
      </TouchableOpacity>

      <View style={styles.waveformContainer}>
        {waveHeights.map((height, index) => (
          <Animated.View
            key={index}
            style={[
              styles.waveBar,
              {
                height,
                transform: [
                  {
                    translateY: waveAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -height / 2],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
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
    backgroundColor: "#d1e7ff",
    borderRadius: 12,
    padding: 10,
    marginVertical: 8,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#7b61ff",
    justifyContent: "center",
    alignItems: "center",
  },
  playButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    marginLeft: 10,
    marginRight: 10,
  },
  waveBar: {
    width: 2,
    backgroundColor: "#c4c4c4",
    marginHorizontal: 2,
    borderRadius: 2,
  },
  speedButton: {
    padding: 5,
    backgroundColor: "#7b61ff",
    borderRadius: 5,
  },
  speedButtonText: {
    color: "#fff",
    fontSize: 14,
  },
  timeText: {
    marginLeft: 10,
    fontSize: 12,
    color: "#333",
  },
});
