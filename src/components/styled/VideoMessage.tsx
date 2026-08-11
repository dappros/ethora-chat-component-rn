import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
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
  /** The backend-generated poster frame (message.locationPreview). */
  previewURL?: string;
}

const PlayBadge: React.FC = () => (
  <View style={styles.overlay} pointerEvents="none">
    <View style={styles.playButton}>
      <PlayIcon width={28} height={28} />
    </View>
  </View>
);

/**
 * Poster path — taken whenever the message carries a `locationPreview`.
 *
 * A chat row only ever needs a still and a play affordance; actual
 * playback happens in the full-screen preview. Drawing that still with a
 * plain <Image> keeps the whole bubble inside the RN view hierarchy, so
 * the play badge is guaranteed to composite on top of it.
 *
 * The VideoView path below cannot make that promise: expo-video draws
 * into a native surface, and depending on platform, expo-video version
 * and surfaceType that surface can end up above its sibling RN views —
 * swallowing the badge and leaving the video looking like a plain photo.
 * It is also cheaper: no video player instance per row in a long list.
 */
const PosterVideo: React.FC<{
  previewURL: string;
  onOpen: () => void;
  onPosterError: () => void;
}> = ({ previewURL, onOpen, onPosterError }) => {
  const [dims, setDims] = useState<MediaDims>(defaultMediaDims());

  useEffect(() => {
    if (!previewURL) {
      return;
    }
    let active = true;
    Image.getSize(
      previewURL,
      (w, h) => {
        if (active) {
          setDims(fitMediaDimensions(w, h));
        }
      },
      () => {
        /* keep the default box if the size probe fails */
      }
    );
    return () => {
      active = false;
    };
  }, [previewURL]);

  return (
    <Pressable
      onPress={onOpen}
      style={[styles.wrapper, { width: dims.width, height: dims.height }]}
      accessibilityRole="button"
      accessibilityLabel="Play video"
    >
      <Image
        source={{ uri: previewURL }}
        style={styles.video}
        resizeMode="cover"
        // Not every backend returns a real still — some set
        // locationPreview to the video URL itself, which decodes to
        // nothing. Rather than show an empty box, hand the row back to
        // the player so it can paint a first frame.
        onError={onPosterError}
      />
      <PlayBadge />
    </Pressable>
  );
};

/**
 * Fallback for messages with no usable poster frame: mount the player
 * purely to paint its first frame.
 */
const VideoSurfaceVideo: React.FC<{
  fileURL: string;
  onOpen: () => void;
}> = ({ fileURL, onOpen }) => {
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

  return (
    // Capture-overlay pattern: VideoView sits underneath without ANY
    // touch participation; a transparent absolute-fill <Pressable> on
    // top owns the tap. Previously we wrapped VideoView in a
    // TouchableOpacity and set `pointerEvents="none"` on the inner
    // VideoView — but on some expo-video versions / iOS the native
    // VideoView still intercepted gestures despite that hint, so
    // tapping the poster did nothing. Customer-reported #9 (video
    // preview unresponsive). The Pressable now guarantees the tap
    // reaches `onOpen`.
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
      <PlayBadge />
      <Pressable
        onPress={onOpen}
        // Sits ON TOP of VideoView + the play-button overlay; transparent
        // so the poster + play icon show through. Captures the tap and
        // routes to onOpen → setActiveModal(FILE_PREVIEW).
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Play video"
      />
    </View>
  );
};

const CustomMessageVideo: React.FC<CustomMessageVideoProps> = ({
  fileName,
  fileURL,
  mimetype,
  previewURL,
}) => {
  const dispatch = useDispatch();
  const [posterFailed, setPosterFailed] = useState(false);

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  if (previewURL && !posterFailed) {
    return (
      <PosterVideo
        previewURL={previewURL}
        onOpen={handleOpen}
        onPosterError={() => setPosterFailed(true)}
      />
    );
  }

  return <VideoSurfaceVideo fileURL={fileURL} onOpen={handleOpen} />;
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
