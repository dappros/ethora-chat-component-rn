import React, { FC, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { ReactionMessage } from '../../types/types';
import { useTheme } from '../../hooks/useTheme';
import { getEmojiNativeById } from '../../helpers/emoji';

interface MessageReactionProps {
  color: string;
  reaction: Record<string, ReactionMessage>;
  changeReaction: (reaction: string) => void;
  userName?: string;

  interactive?: boolean;
}

export const MessageReaction: FC<MessageReactionProps> = ({
  reaction,
  color,
  changeReaction,
  userName,
  interactive = true,
}) => {
  const theme = useTheme();
  const [tooltipEmoji, setTooltipEmoji] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const reactionDetails = useMemo(() => {
    const result: Record<string, { count: number; users: string[] }> = {};
    Object.values(reaction || {}).forEach(({ emoji, data }) => {
      (emoji || []).forEach((em) => {
        if (!result[em]) {result[em] = { count: 0, users: [] };}
        result[em].count += 1;
        result[em].users.push(
          `${data?.senderFirstName || ''} ${data?.senderLastName || ''}`.trim()
        );
      });
    });
    return result;
  }, [reaction]);

  if (!reaction || Object.keys(reactionDetails).length === 0) {return null;}

  const showTooltip = (emoji: string) => {
    setTooltipEmoji(emoji);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  const hideTooltip = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => setTooltipEmoji(null));
  };

  return (
    <View style={styles.row}>
      {Object.entries(reactionDetails).map(([emoji, details]) => {
        const isUserReacted = !!userName && details.users.includes(userName);
        return (
          <View key={emoji} style={styles.chipWrap}>
            <TouchableOpacity
              testID={`reaction-chip-${emoji}`}
              activeOpacity={0.7}
              disabled={!interactive}
              onPress={() => changeReaction(emoji)}
              onLongPress={() => showTooltip(emoji)}
              onPressOut={hideTooltip}
              style={[
                styles.chip,
                {
                  backgroundColor: theme.surface,
                  borderColor: isUserReacted ? color : theme.border,
                  shadowColor: theme.shadow,
                },
              ]}
            >
              {isUserReacted && (
                <View
                  pointerEvents="none"
                  style={[styles.tint, { backgroundColor: `${color}26` }]}
                />
              )}
              <Text style={styles.glyph}>{getEmojiNativeById(emoji)}</Text>
              <Text
                style={[
                  styles.count,
                  { color: isUserReacted ? color : theme.textSecondary },
                ]}
              >
                {details.count}
              </Text>
            </TouchableOpacity>

            {tooltipEmoji === emoji && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.tooltip,
                  {
                    opacity: fadeAnim,
                    transform: [
                      {
                        translateY: fadeAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [4, 0],
                        }),
                      },
                    ],
                    // Inverted pill: text colour as ground, surface as ink,
                    // so it stays high-contrast on both palettes.
                    backgroundColor: theme.text,
                  },
                ]}
              >
                <Text style={[styles.tooltipText, { color: theme.surface }]}>
                  {details.users.filter(Boolean).join(', ')}
                </Text>
              </Animated.View>
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chipWrap: {
    position: 'relative',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  tint: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    borderRadius: 14,
  },
  glyph: {
    fontSize: 16,
    marginRight: 4,
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
  },
  tooltip: {
    position: 'absolute',
    bottom: 34,
    left: 0,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 220,
  },
  tooltipText: {
    fontSize: 12,
  },
});
