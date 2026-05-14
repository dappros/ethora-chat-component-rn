import React, { FC, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, Animated } from "react-native";
import styled from "styled-components/native";
import { ReactionMessage } from "../../types/types";

const ReactionContainer = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const ReactionBox = styled(TouchableOpacity)<{ active: boolean; color: string }>`
  padding: 4px 8px;
  border-radius: 20px;
  background-color: ${({ active, color }) => (active ? color : "#ffffff")};
  flex-direction: row;
  align-items: center;
  justify-content: center;
  elevation: 3;
`;

interface MessageReactionProps {
  color: string;
  reaction: Record<string, ReactionMessage>;
  changeReaction: (reaction: string) => void;
  userName?: string;
}

const emojiMap: Record<string, string> = {
  joy: "😂",
  heart: "❤️",
  fire: "🔥",
  "+1": "👍",
  smile: "😄",
  scream: "😱",
};

export const MessageReaction: FC<MessageReactionProps> = ({
  reaction,
  color,
  changeReaction,
  userName,
}) => {
  const [tooltipEmoji, setTooltipEmoji] = useState<string | null>(null);
  const fadeAnim = new Animated.Value(0);

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

  if (!reaction) return null;

  const reactionDetails = useMemo(() => {
    const result: Record<string, { count: number; users: string[] }> = {};

    Object.values(reaction).forEach(({ emoji, data }) => {
      if (emoji && emoji.length > 0)
        emoji.forEach((em) => {
          if (!result[em]) {
            result[em] = { count: 0, users: [] };
          }
          result[em].count += 1;
          result[em].users.push(`${data.senderFirstName} ${data.senderLastName}`);
        });
    });

    return result;
  }, [reaction]);

  return (
    <ReactionContainer>
      {Object.entries(reactionDetails).map(([emoji, details]) => {
        const isUserReacted = userName
          ? details.users.includes(userName)
          : false;

        return (
          <View key={emoji} style={{ position: "relative" }}>
            <ReactionBox
              active={isUserReacted}
              color={color}
              onPress={() => changeReaction(emoji)}
              onLongPress={() => showTooltip(emoji)}
              onPressOut={hideTooltip}
            >
              <Text style={{ fontSize: 18, marginRight: 4 }}>
                {emojiMap[emoji] || emoji}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: isUserReacted ? "#fff" : color,
                }}
              >
                {details.count}
              </Text>
            </ReactionBox>

            {/* Tooltip */}
            {tooltipEmoji === emoji && (
              <Animated.View
                style={{
                  position: "absolute",
                  bottom: 36,
                  left: "50%",
                  transform: [
                    { translateX: -50 },
                    {
                      translateY: fadeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 0],
                      }),
                    },
                  ],
                  opacity: fadeAnim,
                  backgroundColor: "#333",
                  borderRadius: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  maxWidth: 220,
                  zIndex: 999,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 12 }}>
                  {details.users.join(", ")}
                </Text>
              </Animated.View>
            )}
          </View>
        );
      })}
    </ReactionContainer>
  );
};
