import React, { createContext } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextStyle,
} from "react-native";
import { getTintedColor } from "../../../helpers/getTintedColor";

// Container with burger menu support
export const Container = ({
  burgerMenu,
  open,
  children,
}: {
  burgerMenu?: boolean;
  open?: boolean;
  children: React.ReactNode;
}) => (
  <View
    style={[
      styles.container,
      burgerMenu && open ? styles.containerOpen : styles.containerClosed,
      burgerMenu && styles.burgerMenu,
    ]}
  >
    {children}
  </View>
);

// Button for the burger menu
export const BurgerButton = ({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity style={styles.burgerButton} onPress={onPress}>
    <Text style={styles.burgerButtonText}>☰</Text>
  </TouchableOpacity>
);

// Chat item
const ColorContext = createContext<string | undefined>(undefined);

export const ChatItem = ({
  onPress,
  children,
}: {
  bg?: string;
  onPress: () => void;
  children: React.ReactNode;
}) => {
  return (
    <View style={styles.chatItem} onTouchEnd={onPress}>
      {children}
    </View>
  );
};

// Search container for the chat area
export const SearchContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => <View style={styles.searchContainer}>{children}</View>;

// Scrollable container
export const ScollableContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => <View style={styles.scollableContainer}>{children}</View>;

// Chat info (name & last message)
export const ChatInfo = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.chatInfo}>{children}</View>
);

// Chat name and last message display
export const ChatName = ({ text }: { text: string }) => (
  <Text style={styles.chatName}>{text}</Text>
);

export const LastMessage = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.lastMessage}>{children}</Text>
);

// User count display for the chat
export const UserCount = ({
  style,
  text,
}: {
  text: string;
  style: TextStyle;
}) => <Text style={[styles.userCount, style]}>{text}</Text>;

export const Viewider = () => <View style={styles.viewider} />;

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 0,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  burgerMenu: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 300,
    height: "100%",
    transform: [{ translateX: -300 }],
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#fff",
    padding: 16,
    borderRightWidth: 1,
    borderRightColor: "#f0f0f0",
  },
  containerOpen: {
    transform: [{ translateX: 0 }],
  },
  containerClosed: {
    transform: [{ translateX: -300 }],
  },
  burgerButton: {
    position: "absolute",
    left: 10,
    top: 10,
    padding: 10,
  },
  burgerButtonText: {
    fontSize: 24,
    color: "#333",
  },
  chatItem: {
    borderRadius: 16,
    gap: 16,
    color: "#000",
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  searchContainer: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    paddingHorizontal: 12,
  },
  scollableContainer: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
  },
  chatInfo: {
    maxWidth: "60%",
  },
  chatName: {
    fontWeight: "bold",
  },
  lastMessage: {
    color: "#999",
  },
  userCount: {
    marginLeft: "auto",
  },
  viewider: {
    height: 1,
    width: "100%",
    backgroundColor: "#0052cd0d",
  },
});
