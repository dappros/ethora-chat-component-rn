import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
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
  // Neutral box until the first frame is ready; then size to the real
  // video aspect ratio (portrait stays portrait, landscape landscape).
  const [dims, setDims] = useState<MediaDims>(defaultMediaDims());

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    <TouchableOpacity
      onPress={handleOpen}
      activeOpacity={0.9}
      style={[styles.wrapper, { width: dims.width, height: dims.height }]}
    >
      {/* Inline preview only — the first frame stands in as a poster.
          Native controls are intentionally OFF here: in the small bubble
          they swallowed the tap and looked cramped. Tapping opens the
          full-screen player where the video plays with controls. */}
      <Video
        source={{ uri: fileURL }}
        style={styles.video}
        resizeMode={ResizeMode.COVER}
        shouldPlay={false}
        isMuted
        onReadyForDisplay={(e: any) => {
          const ns = e?.naturalSize;
          if (ns?.width && ns?.height) {
            let w = ns.width;
            let h = ns.height;
            // Some platforms report raw pixel dims with a separate
            // orientation flag; swap so a portrait clip is sized tall.
            if (ns.orientation === 'portrait' && w > h) {
              [w, h] = [h, w];
            }
            setDims(fitMediaDimensions(w, h));
          }
        }}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.playButton}>
          <PlayIcon width={28} height={28} />
        </View>
      </View>
    </TouchableOpacity>
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
