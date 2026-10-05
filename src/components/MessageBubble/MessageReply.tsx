import React, { FC } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';

interface MessageReplyProps {
  isUser: boolean;
  text: string;
  /** The parent's author, when the reply carries it. */
  userName?: string;
  color?: string;
  handleReplyMessage: () => void;
}

/**
 * Quote of the parent at the top of a reply that was also sent to the
 * channel (WhatsApp-style): accent bar, author, up to two lines of text.
 * Tapping opens the parent's thread.
 */
export const MessageReply: FC<MessageReplyProps> = ({
  isUser,
  text,
  userName,
  color,
  handleReplyMessage,
}) => {
  const theme = useTheme();
  const accent = color || theme.primary;
  return (
    <TouchableOpacity
      testID="message-reply-quote"
      activeOpacity={0.7}
      onPress={handleReplyMessage}
      style={[
        styles.quote,
        {
          // A tint of the bubble's own ground, so it reads on both sides
          // and in both themes.
          backgroundColor: isUser ? 'rgba(0,0,0,0.12)' : theme.surfaceSecondary,
        },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <View style={styles.body}>
        {!!userName && (
          <Text numberOfLines={1} style={[styles.author, { color: accent }]}>
            {userName}
          </Text>
        )}
        <Text
          numberOfLines={2}
          style={[styles.text, { color: isUser ? theme.messageTextUser : theme.text }]}
        >
          {text}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  bar: {
    width: 4,
  },
  body: {
    flexShrink: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  author: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  text: {
    fontSize: 14,
  },
});
