import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface SystemMessageProps {
  messageText?: string;
  colors?: { primary?: string; secondary?: string };
}

const SystemMessage: React.FC<SystemMessageProps> = ({
  messageText,
  colors,
}) => {
  return (
    <View style={styles.container}>
      {/* maxWidth lives on this View (not the Text) so the Text reliably
          wraps to multiple lines instead of staying on one line and
          getting clipped — a styled.Text with a percentage max-width
          doesn't bound its own line box the way a View does. */}
      <View
        style={[
          styles.bubble,
          { backgroundColor: colors?.secondary || '#e7edf9' },
        ]}
      >
        <Text style={[styles.text, { color: colors?.primary || '#0052cd' }]}>
          {messageText}
        </Text>
      </View>
    </View>
  );
};

export default SystemMessage;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
