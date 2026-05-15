import React, { FC, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

// Define props
interface ComposingProps {
  usersTyping?: string[];
  style?: any;
}

// Composing component
const Composing: FC<ComposingProps> = ({ usersTyping = ['User'], style }) => {
  const fadeAnim1 = useRef(new Animated.Value(0.2)).current;
  const fadeAnim2 = useRef(new Animated.Value(0.2)).current;
  const fadeAnim3 = useRef(new Animated.Value(0.2)).current;

  const animateDot = (animatedValue: Animated.Value, delay: number) => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
          delay,
        }),
        Animated.timing(animatedValue, {
          toValue: 0.2,
          duration: 300,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  useEffect(() => {
    animateDot(fadeAnim1, 0);
    animateDot(fadeAnim2, 200);
    animateDot(fadeAnim3, 400);
  }, []);

  let typingText: string;
  if (usersTyping.length === 1) {
    typingText = `${usersTyping[0]} is typing`;
  } else if (usersTyping.length === 2) {
    typingText = `${usersTyping[0]} and ${usersTyping[1]} are typing`;
  } else if (usersTyping.length > 2) {
    typingText = `${usersTyping.length} people are typing`;
  } else {
    typingText = '';
  }

  return (
    <View style={[styles.wrapper, style]}>
      {typingText ? (
        <Text style={styles.typingText}>{typingText}</Text>
      ) : (
        <View />
      )}
      <View style={styles.dotsContainer}>
        <Animated.Text style={[styles.dot, { opacity: fadeAnim1 }]}>
          .
        </Animated.Text>
        <Animated.Text style={[styles.dot, { opacity: fadeAnim2 }]}>
          .
        </Animated.Text>
        <Animated.Text style={[styles.dot, { opacity: fadeAnim3 }]}>
          .
        </Animated.Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  typingText: {
    marginRight: 4,
    fontSize: 12,
    color: '#71717A',
    fontStyle: 'italic',
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    fontSize: 18,
    lineHeight: 18,
    marginHorizontal: 1,
    color: '#71717A',
  },
});

export default Composing;
