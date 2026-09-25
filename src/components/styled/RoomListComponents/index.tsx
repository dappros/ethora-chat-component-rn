import React, { createContext } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextStyle,
} from 'react-native';
import { getTintedColor } from '../../../helpers/getTintedColor';
import { useTheme } from '../../../hooks/useTheme';

// Container with burger menu support
export const Container = ({
  burgerMenu,
  open,
  children,
}: {
  burgerMenu?: boolean;
  open?: boolean;
  children: React.ReactNode;
}) => {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface },
        burgerMenu && open ? styles.containerOpen : styles.containerClosed,
        burgerMenu && [
          styles.burgerMenu,
          { backgroundColor: theme.surface, borderRightColor: theme.border },
        ],
      ]}
    >
      {children}
    </View>
  );
};

// Button for the burger menu
export const BurgerButton = ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme();
  return (
    <TouchableOpacity style={styles.burgerButton} onPress={onPress}>
      <Text style={[styles.burgerButtonText, { color: theme.text }]}>☰</Text>
    </TouchableOpacity>
  );
};

// Chat item
const ColorContext = createContext<string | undefined>(undefined);

export const ChatItem = ({
  children,
}: {
  bg?: string;
  children: React.ReactNode;
}) => {
  return <View style={styles.chatItem}>{children}</View>;
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
// One line, ellipsised. Without this a long room title (or a display name
// that happens to be an email) wrapped to three or four lines and pushed
// the whole row's height around.
export const ChatName = ({ text }: { text: string }) => {
  const theme = useTheme();
  return (
    <Text
      style={[styles.chatName, { color: theme.text }]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {text}
    </Text>
  );
};

export const LastMessage = ({ children }: { children: React.ReactNode }) => {
  const theme = useTheme();
  return (
    <Text
      style={[styles.lastMessage, { color: theme.textMuted }]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {children}
    </Text>
  );
};

// User count display for the chat
export const UserCount = ({
  style,
  text,
}: {
  text: string;
  style: TextStyle;
}) => <Text style={[styles.userCount, style]}>{text}</Text>;

export const Viewider = () => {
  const theme = useTheme();
  return (
    <View
      style={[styles.viewider, { backgroundColor: theme.surfaceHighlight }]}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 0,
    overflow: 'hidden',
  },
  burgerMenu: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 300,
    height: '100%',
    transform: [{ translateX: -300 }],
    display: 'flex',
    flexDirection: 'column',
    padding: 16,
    borderRightWidth: 1,
  },
  containerOpen: {
    transform: [{ translateX: 0 }],
  },
  containerClosed: {
    transform: [{ translateX: -300 }],
  },
  burgerButton: {
    position: 'absolute',
    left: 10,
    top: 10,
    padding: 10,
  },
  burgerButtonText: {
    fontSize: 24,
  },
  chatItem: {
    borderRadius: 16,
    gap: 16,
    color: '#000',
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  searchContainer: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    paddingHorizontal: 12,
  },
  scollableContainer: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  chatInfo: {
    // `flexShrink` + `minWidth: 0` is what actually lets the child Text
    // ellipsise: without them the row keeps its intrinsic width and the
    // text wraps instead of truncating, whatever numberOfLines says.
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '80%',
  },
  chatName: {
    fontWeight: 'bold',
  },
  lastMessage: {},
  userCount: {
    marginLeft: 'auto',
  },
  viewider: {
    height: 1,
    width: '100%',
  },
});
