import React, { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface TranslatedMessageBodyProps {
  /** Text as sent, in the sender's language. */
  originalText: string;
  accentColor?: string;
  /** Renders the translated text (the parsed message body). */
  children: ReactNode;
  /**
   * Whether this message was sent by the current user. The sender already
   * knows what they wrote, so their own messages skip the quote-plus-
   * translation treatment and just show the original (never translated).
   */
  isUser: boolean;
}

/**
 * A message body that is showing a translation: the translated text reads
 * as the primary content, with the original quoted above it (accent bar,
 * dimmed) for reference — the same visual language MessageReply uses.
 * Ported from the web SDK's TranslatedMessageBody. Own messages (`isUser`)
 * show only the original.
 */
export const TranslatedMessageBody: React.FC<TranslatedMessageBodyProps> = ({
  originalText,
  accentColor = '#0052CD',
  children,
  isUser,
}) => {
  if (isUser) {
    return <View>{children}</View>;
  }
  return (
    <View>
      <View style={[styles.quote, { borderLeftColor: accentColor }]}>
        <Text style={styles.quoteText}>{originalText}</Text>
      </View>
      <View>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  quote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 6,
  },
  quoteText: {
    fontSize: 13,
    lineHeight: 19,
    // Dimmed relative to the translated body — matches the web quote's
    // opacity:0.6 look without depending on the (variable) text colour.
    color: '#71717A',
  },
});

export default TranslatedMessageBody;
