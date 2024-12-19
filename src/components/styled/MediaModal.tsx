import React from 'react';
import {View, Modal, StyleSheet} from 'react-native';

export const Overlay = ({
  children,
  visible,
}: {
  children: React.ReactNode;
  visible: boolean;
}) => (
  <Modal
    transparent={true}
    animationType="fade"
    visible={visible}
    onRequestClose={() => {
      // Implement logic to close the modal if needed
    }}>
    <View style={styles.overlay}>{children}</View>
  </Modal>
);

export const StyledModal = ({children}: {children: React.ReactNode}) => (
  <View style={styles.modal}>{children}</View>
);

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999, // Use zIndex for stacking, although this won't work in all cases, Android uses elevation.
    elevation: 999, // Added to give the overlay layer a higher stacking context on Android.
  },
  modal: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '70%',
    height: '70%',
    backgroundColor: 'white',
    padding: 0,
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{translateX: -'50%'}, {translateY: -'50%'}],
  },
});
