import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useTheme } from '../../hooks/useTheme';

interface MediaCaptionProps {
  text?: string;
  isUser: boolean;
}

/**
 * The text sent with a media message, under the media inside the bubble.
 * Plain text: mention spans are stored on the message but not rendered here.
 */
const MediaCaption: React.FC<MediaCaptionProps> = ({ text, isUser }) => {
  const theme = useTheme();
  const { config } = useChatSettingState();
  if (!text) {return null;}
  const typography = config?.typography?.messageText;
  return (
    <Text
      testID="media-caption"
      style={[
        styles.caption,
        { color: isUser ? theme.messageTextUser : theme.messageText },
        typography?.fontSize ? { fontSize: typography.fontSize } : null,
        typography?.fontWeight ? { fontWeight: typography.fontWeight as any } : null,
      ]}
    >
      {text}
    </Text>
  );
};

export default MediaCaption;

const styles = StyleSheet.create({
  caption: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
    alignSelf: 'stretch',
  },
});
