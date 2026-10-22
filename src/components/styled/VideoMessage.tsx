import React, { useEffect, useState } from 'react';
import {
  isSecureFileUrl,
  requestFileTokenRecovery,
} from '../../helpers/secureFileUrl';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useDispatch } from 'react-redux';
import {
  setActiveFile,
  setActiveModal,
} from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { useMediaSource } from '../../context/MediaSourceContext';
import { PlayIcon } from '../../assets/icons';
import {
  defaultMediaDims,
  fitMediaDimensions,
  MediaDims,
} from '../../helpers/mediaDimensions';

interface CustomMessageVideoProps {
  fileName: string;
  /**
   * The sender's original file name (bug #40) - kept alongside `fileName`
   * so the preview modal's save/share/download logic can prefer it over
   * the server's stored/hashed name.
   */
  originalName?: string;
  fileURL: string;
  mimetype: string;
  /** The backend-generated poster frame (message.locationPreview). */
  previewURL?: string;
  /** Album mode: fill a tile of exactly this size (square corners; the tile clips). */
  tile?: { width: number; height: number };
  /** Replaces the default "open this one file" tap, e.g. to open an album at an index. */
  onOpen?: () => void;
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
 */
const PosterVideo: React.FC<{
  previewURL: string;
  onOpen: () => void;
  onPosterError: () => void;
  tile?: { width: number; height: number };
}> = ({ previewURL, onOpen, onPosterError, tile }) => {
  const [measured, setDims] = useState<MediaDims>(defaultMediaDims());
  const dims: MediaDims = tile ?? measured;

  useEffect(() => {
    if (!previewURL || tile) {
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
  }, [previewURL, tile]);

  return (
    <Pressable
      onPress={onOpen}
      style={[
        styles.wrapper,
        { width: dims.width, height: dims.height },
        tile && styles.tileWrapper,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Play video"
    >
      <Image
        source={{ uri: previewURL }}
        style={styles.video}
        resizeMode="cover"
        // Not every backend returns a real still — some set
        // locationPreview to the video URL itself, which decodes to
        // nothing. Rather than show an empty box, fall back to the
        // static placeholder branch.
        onError={onPosterError}
      />
      <PlayBadge />
    </Pressable>
  );
};

/**
 * Fallback for messages with no usable poster frame: a static dark
 * placeholder behind the play badge.
 *
 * This branch used to mount an expo-video player purely to paint the
 * first frame (`VideoView` + `surfaceType="textureView"`). That never
 * composited reliably: on Android (Pixel, Android 16, New Architecture)
 * the native video surface draws ABOVE sibling RN views, swallowing the
 * play badge — the video looked like a plain photo. There is no
 * surfaceType/zIndex combination that guarantees ordering across SDK 54
 * and 57, so we don't fight it: no live surface in the bubble at all.
 * The badge is plain RN views over a plain RN background, which cannot
 * be occluded, and we drop the per-row player instance as a bonus.
 * Actual playback (and the real first frame) happens in the full-screen
 * preview modal.
 */
const PlaceholderVideo: React.FC<{
  onOpen: () => void;
  tile?: { width: number; height: number };
}> = ({ onOpen, tile }) => {
  const dims = tile ?? defaultMediaDims();

  return (
    <Pressable
      onPress={onOpen}
      style={[
        styles.wrapper,
        { width: dims.width, height: dims.height },
        tile && styles.tileWrapper,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Play video"
    >
      <PlayBadge />
    </Pressable>
  );
};

const CustomMessageVideo: React.FC<CustomMessageVideoProps> = ({
  fileName,
  originalName,
  fileURL,
  mimetype,
  previewURL,
  tile,
  onOpen,
}) => {
  const dispatch = useDispatch();
  const source = useMediaSource();
  const [posterFailed, setPosterFailed] = useState(false);

  const handleOpen = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    dispatch(
      setActiveFile({ fileName, fileURL, mimetype, originalName, previewURL, source })
    );
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  if (previewURL && !posterFailed) {
    return (
      <PosterVideo
        previewURL={previewURL}
        onOpen={handleOpen}
        tile={tile}
        onPosterError={() => {
          if (isSecureFileUrl(previewURL)) {
            requestFileTokenRecovery();
          }
          setPosterFailed(true);
        }}
      />
    );
  }

  return <PlaceholderVideo onOpen={handleOpen} tile={tile} />;
};

export default CustomMessageVideo;

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  tileWrapper: {
    borderRadius: 0,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
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
