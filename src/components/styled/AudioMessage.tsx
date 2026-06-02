import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { PauseIcon, PlayIcon } from '../../assets/icons';
import { useChatSettingState } from '../../hooks/useChatSettingState';

const formatTime = (millis: number) => {
  const totalSec = Math.floor(millis / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const AudioMessage = ({ src }: { src: string }) => {
  const { config } = useChatSettingState();
  const soundRef = useRef<Audio.Sound | null>(null);
  const didFinishRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const primaryColor = config?.colors?.primary || '#0A84FF';

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPosition(status.positionMillis);
    setDuration(status.durationMillis ?? 0);
    setIsPlaying(status.isPlaying);
    if (status.didJustFinish) {
      didFinishRef.current = true;
      setIsPlaying(false);
      setPosition(0);
      void soundRef.current?.setStatusAsync({
        shouldPlay: false,
        positionMillis: 0,
      });
    }
  };

  const togglePlayback = async () => {
    if (!src) {
      return;
    }
    try {
      if (!soundRef.current) {
        setIsLoading(true);
        const { sound } = await Audio.Sound.createAsync(
          { uri: src },
          { shouldPlay: true },
          onPlaybackStatusUpdate
        );
        soundRef.current = sound;
        setIsLoading(false);
        setIsPlaying(true);
        return;
      }

      if (isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        if (didFinishRef.current) {
          await soundRef.current.setPositionAsync(0);
          didFinishRef.current = false;
        }
        await soundRef.current.playAsync();
      }
    } catch (error) {
      console.error('Audio playback error:', error);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const progress = duration > 0 ? position / duration : 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.playButton, { backgroundColor: primaryColor }]}
        onPress={togglePlayback}
        disabled={isLoading}
        activeOpacity={0.85}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <View style={styles.iconWrap}>
            {isPlaying ? (
              <PauseIcon width={18} height={18} color="#fff" />
            ) : (
              <PlayIcon width={18} height={18} color="#fff" />
            )}
          </View>
        )}
      </TouchableOpacity>
      <View style={styles.progressContainer}>
        <View style={styles.progressRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%`, backgroundColor: primaryColor },
            ]}
          />
        </View>
      </View>
    </View>
  );
};

export default AudioMessage;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 260,
    maxWidth: '100%',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    marginLeft: 1,
  },
  progressContainer: {
    flex: 1,
    gap: 8,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#D0D7E6',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  time: {
    fontSize: 12,
    color: '#667085',
    fontWeight: '500',
  },
});
