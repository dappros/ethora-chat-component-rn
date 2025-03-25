import React from 'react';
import {View, Modal, StyleSheet, ViewStyle, Text} from 'react-native';

interface OverlayProps {
  children?: React.ReactNode;
  visible?: boolean;
  style?: ViewStyle;
}

export const Overlay = ({children, visible, style}: OverlayProps) => (
  <Modal
    transparent={true}
    animationType="fade"
    visible={visible}
    onRequestClose={() => {
      // Implement logic to close the modal if needed
    }}>
    <View style={[styles.modal, style]}>{children}</View>;
  </Modal>
);

export const StyledModal = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) => <Text style={[styles.modal, style]}>{children}</Text>;

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
  },
});
