/** @format */

import React from "react";
import { View, Modal, StyleSheet, ViewStyle, Text } from "react-native";

interface OverlayProps {
  children?: React.ReactNode;
  visible?: boolean;
  style?: ViewStyle;
}

export const Overlay = ({ children, visible, style }: OverlayProps) => (
  <Modal
    transparent={true}
    animationType="fade"
    visible={visible}
    onRequestClose={() => {
      // Implement logic to close the modal if needed
    }}
  >
    <View style={[styles.modal, style]}>{children}</View>;
  </Modal>
);

export const StyledModal = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) => {
  return <Text style={[style]}>{children}</Text>;
};

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999, // Use zIndex for stacking, although this won't work in all cases, Android uses elevation.
    elevation: 999, // Added to give the overlay layer a higher stacking context on Android.
  },
  modal: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "white",
    padding: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
});
