import React, { useState, useRef, useEffect } from 'react';
import { View, Text } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import styled from 'styled-components/native';
import { DoubleTick } from '../../assets/icons';

interface AudioMessageBubbleProps {
  audioUrl: string;
  duration?: number;
  timestamp: string;
  isUser: boolean;
  waveForm?: number[];
}

const AudioBubble = styled.View`
  background-color: #1C274C;
  border-radius: 12px;
  padding: 12px 16px;
  flex-direction: row;
  align-items: center;
  min-width: 200px;
  max-width: 80%;
`;

const PlayButtonContainer = styled.TouchableOpacity`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background-color: white;
  justify-content: center;
  align-items: center;
  margin-right: 12px;
`;

const PlayIcon = styled.View`
  width: 0;
  height: 0;
  border-left-width: 10px;
  border-left-color: #1C274C;
  border-top-width: 6px;
  border-top-color: transparent;
  border-bottom-width: 6px;
  border-bottom-color: transparent;
  margin-left: 3px;
`;

const PauseIcon = styled.View`
  width: 12px;
  height: 12px;
  flex-direction: row;
  justify-content: space-between;
`;

const PauseBar = styled.View`
  width: 3px;
  height: 12px;
  background-color: #1C274C;
  border-radius: 1px;
`;

const WaveformContainer = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: center;
  height: 24px;
  margin-right: 8px;
`;

const WaveBar = styled.View<{ height: number; isPlayed: boolean }>`
  width: 2px;
  height: ${({ height }) => height}px;
  background-color: ${({ isPlayed }) => (isPlayed ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)')};
  border-radius: 1px;
  margin-right: 2px;
`;

const TimeContainer = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 4px;
`;

const TimeText = styled.Text`
  color: white;
  font-size: 12px;
  margin-right: 4px;
`;

const TimestampText = styled.Text`
  color: white;
  font-size: 12px;
  opacity: 0.7;
`;

const StatusContainer = styled.View`
  margin-left: 4px;
`;

const AudioMessageBubble: React.FC<AudioMessageBubbleProps> = ({
  audioUrl,
  duration,
  timestamp,
  isUser,
  waveForm,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const audioPlayer = useRef(new AudioRecorderPlayer()).current;

  const generateWaveform = (): number[] => {
    if (waveForm && waveForm.length > 0) {
      return waveForm.slice(0, 50);
    }
    const bars: number[] = [];
    for (let i = 0; i < 50; i++) {
      bars.push(Math.random() * 20 + 2);
    }
    return bars;
  };

  const waveform = generateWaveform();
  const progress = totalDuration > 0 ? currentTime / totalDuration : 0;
  const playedBars = Math.floor(waveform.length * progress);

  useEffect(() => {
    return () => {
      audioPlayer.stopPlayer();
      audioPlayer.removePlayBackListener();
    };
  }, []);

  const handlePlayPause = async () => {
    try {
      if (isPlaying) {
        await audioPlayer.pausePlayer();
        setIsPlaying(false);
      } else {
        if (!audioUrl || audioUrl.trim() === '') {
          console.error('Audio URL is empty or invalid:', audioUrl);
          return;
        }

        if (!audioUrl.startsWith('file://') && !audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
          console.error('Invalid audio URL format:', audioUrl);
          return;
        }

        console.log('Starting playback of audio:', audioUrl);
        const msg = await audioPlayer.startPlayer(audioUrl);
        if (duration && duration > 0) {
          setTotalDuration(duration);
        }

        audioPlayer.addPlayBackListener((e) => {
          const currentPosition = e.currentPosition / 1000;
          const totalDurationMs = e.duration || 0;
          if (totalDurationMs > 0 && !duration) {
            setTotalDuration(totalDurationMs / 1000);
          }
          setCurrentTime(currentPosition);

          if (totalDurationMs > 0 && currentPosition >= totalDurationMs / 1000) {
            setIsPlaying(false);
            setCurrentTime(0);
            audioPlayer.stopPlayer();
            audioPlayer.removePlayBackListener();
          }
        });

        setIsPlaying(true);
      }
    } catch (error: any) {
      console.error('Error playing audio:', {
        error: error?.message || error,
        audioUrl,
        code: error?.code,
      });
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <AudioBubble>
      <PlayButtonContainer onPress={handlePlayPause}>
        {isPlaying ? (
          <PauseIcon>
            <PauseBar />
            <PauseBar />
          </PauseIcon>
        ) : (
          <PlayIcon />
        )}
      </PlayButtonContainer>

      <View style={{ flex: 1 }}>
        <WaveformContainer>
          {waveform.map((height, index) => (
            <WaveBar
              key={index}
              height={height}
              isPlayed={index < playedBars}
            />
          ))}
        </WaveformContainer>

        <TimeContainer>
          <TimeText>{formatTime(currentTime || 0)}</TimeText>
          <Text style={{ color: 'white', fontSize: 12, opacity: 0.7 }}>•</Text>
          <TimestampText>{timestamp}</TimestampText>
          {isUser && (
            <StatusContainer>
              <DoubleTick />
            </StatusContainer>
          )}
        </TimeContainer>
      </View>
    </AudioBubble>
  );
};

export default AudioMessageBubble;

