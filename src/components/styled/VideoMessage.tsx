import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useDispatch } from 'react-redux';
import {
  setActiveFile,
  setActiveModal,
} from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { PlayIcon } from '../../assets/icons';
import {
  defaultMediaDims,
  fitMediaDimensions,
  MediaDims,
} from '../../helpers/mediaDimensions';

interface CustomMessageVideoProps {
  fileName: string;
  fileURL: string;
  mimetype: string;
}

const CustomMessageVideo: React.FC<CustomMessageVideoProps> = ({
  fileName,
  fileURL,
  mimetype,
}) => {
  const dispatch = useDispatch();
  const [dims, setDims] = useState<MediaDims>(defaultMediaDims());

  const player = useVideoPlayer(fileURL, (p) => {
    p.muted = true;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', () => {
      const size = player.videoTrack?.size;
      if (size?.width && size?.height) {
        setDims(fitMediaDimensions(size.width, size.height));
      }
    });
    return () => sub.remove();
  }, [player]);

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    // Capture-overlay pattern: VideoView sits underneath without ANY
    // touch participation; a transparent absolute-fill <Pressable> on
    // top owns the tap. Previously we wrapped VideoView in a
    // TouchableOpacity and set `pointerEvents="none"` on the inner
    // VideoView — but on some expo-video versions / iOS the native
    // VideoView still intercepted gestures despite that hint, so
    // tapping the poster did nothing. Customer-reported #9 (video
    // preview unresponsive). The Pressable now guarantees the tap
    // reaches `handleOpen`.
    <View
      style={[styles.wrapper, { width: dims.width, height: dims.height }]}
    >
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
        pointerEvents="none"
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.playButton}>
          <PlayIcon width={28} height={28} />
        </View>
      </View>
      <Pressable
        testID="message-media-video"
        onPress={handleOpen}
        // Sits ON TOP of VideoView + the play-button overlay; transparent
        // so the poster + play icon show through. Captures the tap and
        // routes to handleOpen → setActiveModal(FILE_PREVIEW).
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Play video"
      />
    </View>
  );
};

export default CustomMessageVideo;

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
