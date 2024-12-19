import React from 'react';
import {View, Text, TouchableOpacity, Image, StyleSheet} from 'react-native';
import {useDispatch} from 'react-redux';
import {setActiveFile, setActiveModal} from '../../roomStore/chatSettingsSlice';
import {MODAL_TYPES} from '../../helpers/constants/MODAL_TYPES';

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
    dispatch(setActiveFile({fileName, fileURL, mimetype}));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handleOpen}>
        <Image
          source={{uri: fileURL}}
          style={styles.fixedSizeVideo}
          resizeMode="cover"
        />
      </TouchableOpacity>
    </View>
  );
};

export default CustomMessageVideo;

const styles = StyleSheet.create({
  container: {
    margin: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixedSizeVideo: {
    width: 300,
    height: 200,
    borderRadius: 10,
  },
});
