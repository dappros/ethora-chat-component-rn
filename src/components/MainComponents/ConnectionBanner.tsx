/** @format */

import React from "react";
import { View, Text, StyleSheet } from "react-native";

const ConnectionBanner: React.FC = () => {
  return (
    <View style={styles.bannerContainer}>
      <Text style={styles.bannerText}>Connection lost. Retrying...</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    backgroundColor: "#ff9800",
    padding: 8,
    paddingHorizontal: 16,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  bannerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
});

export default ConnectionBanner;

