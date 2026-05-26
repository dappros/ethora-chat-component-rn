import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useDispatch } from 'react-redux';
import {
  setActiveFile,
  setActiveModal,
} from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';

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

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    <TouchableOpacity style={styles.container} onPress={handleOpen}>
      <Video
        source={{ uri: fileURL }}
        style={styles.video}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={false}
      />
    </TouchableOpacity>
  );
};

export default CustomMessageVideo;

const styles = StyleSheet.create({
  container: {
    margin: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  video: {
    width: 300,
    height: 200,
    borderRadius: 10,
    backgroundColor: '#000',
  },
});
