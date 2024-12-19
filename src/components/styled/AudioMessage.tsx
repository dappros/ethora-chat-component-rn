import React, {useState, useRef, useEffect} from 'react';
import Button from './Button';
import {PauseIcon, PlayIcon} from '../../assets/icons';
import {useSelector} from 'react-redux';
import {RootState} from '../../roomStore';

interface AudioMessageProps {
  src: string;
}

const AudioMessage: React.FC<AudioMessageProps> = ({src}) => {
  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config,
  );

  const waveformRef = useRef(null);
  const wavesurfer = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const changeSpeed = () => {
    const newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(newRate);
  };

  return (
    <View
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        zIndex: 1,
      }}>
      <Button
        onClick={togglePlayPause}
        style={{
          color: '#141414',
          backgroundColor: config?.colors?.primary || '#0052CD',
          borderRadius: 1000,
        }}
        EndIcon={isPlaying ? <PauseIcon /> : <PlayIcon />}
      />
      <View
        style={{
          flex: 1,
          width: '150px',
        }}
      />
      <Button
        onClick={changeSpeed}
        style={{color: '#141414', fontSize: 14, zIndex: 0}}
        text={`${playbackRate}X`}
      />
    </View>
  );
};

export default AudioMessage;
