import {StyleSheet, View} from 'react-native';
import React from 'react';
import NoMessages from '../assets/NoMessages.svg';

const NoMessagesModal = () => {
  return (
    <View style={styles.modalContainer}>
      <NoMessages />
    </View>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    zIndex: -1,
  },
});

export default NoMessagesModal;
