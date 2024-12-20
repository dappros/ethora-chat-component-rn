import React, { useState, useRef, useEffect } from "react";
import Button from "./Button";
import { PauseIcon, PlayIcon } from "../../assets/icons";
import { useSelector } from "react-redux";
import { RootState } from "../../roomStore";
import { View } from "react-native";

interface AudioMessageProps {
  src: string;
}

const AudioMessage: React.FC<AudioMessageProps> = ({ src }) => {
  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const waveformRef = useRef(null);
  const wavesurfer = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const togglePlayPause = () => {
    setIsPlaying((prev) => !prev);
    wavesurfer.current.playPause();
  };

  const changeSpeed = () => {
    const newRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(newRate);
  };

  useEffect(() => {
    wavesurfer.current = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "#C4C4C4",
      progressColor: config?.colors?.primary || "#0052CD",
      cursorColor: "transparent",
      height: 32,
      barWidth: 3,
      barHeight: 6,
      barGap: 2,
      barRadius: 1000,
    });

    wavesurfer.current.load(src);

    wavesurfer.current.on("seek", () => {
      wavesurfer.current.play();
      setIsPlaying(true);
    });

    wavesurfer.current.on("finish", () => {
      setIsPlaying(false);
    });

    return () => {
      wavesurfer.current.destroy();
    };
  }, [src]);

  return (
    <View
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        zIndex: 1,
      }}
    >
      <Button
        onPress={togglePlayPause}
        style={{
          backgroundColor: config?.colors?.primary || "#0052CD",
          borderRadius: 1000,
        }}
        color="#141414"
        EndIcon={isPlaying ? <PauseIcon /> : <PlayIcon />}
      />
      <View
        style={{
          flex: 1,
          width: 150,
        }}
      />
      <Button
        onClick={changeSpeed}
        style={{ fontSize: 14, zIndex: 0 }}
        text={`${playbackRate}X`}
        color="#141414"
      />
    </View>
  );
};

export default AudioMessage;
