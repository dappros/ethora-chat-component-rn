import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { useBubbleHighlightUntil } from '../../helpers/bubbleHighlight';
import { useTheme } from '../../hooks/useTheme';

const FADE_IN_MS = 150;

const Ring: React.FC<{ remainingMs: number }> = ({ remainingMs }) => {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  // Fixed at mount: a re-render must not restart the pulse.
  const startRemainingRef = useRef(remainingMs);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.resolve(AccessibilityInfo?.isReduceMotionEnabled?.())
      .then((value) => {
        if (alive) {setReduceMotion(Boolean(value));}
      })
      .catch(() => {
        if (alive) {setReduceMotion(false);}
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) {return;}
    if (reduceMotion) {
      // A static ring for the rest of the second: no movement, still visible.
      opacity.setValue(1);
      return;
    }
    const total = startRemainingRef.current;
    const fadeIn = Math.min(FADE_IN_MS, total);
    const animation = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: fadeIn,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: Math.max(0, total - fadeIn),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, opacity]);

  return (
    <Animated.View
      testID="bubble-highlight"
      pointerEvents="none"
      style={[
        styles.ring,
        {
          opacity,
          borderColor: theme.primary,
          backgroundColor: theme.primary + '22',
        },
      ]}
    />
  );
};

/**
 * The brief ring and tint a jump puts on the bubble of the message it landed
 * on (not on the whole row: the row also holds the date label and the
 * avatar). Renders inside the bubble, which clips it to the bubble's corners.
 * Nothing is mounted for a message without a running highlight.
 */
export const BubbleHighlight: React.FC<{ messageId: string }> = ({
  messageId,
}) => {
  const until = useBubbleHighlightUntil(String(messageId));
  const [, setTick] = useState(0);
  const remaining = until - Date.now();

  // Drop the ring when its time is up even if nothing else re-renders.
  useEffect(() => {
    if (remaining <= 0) {return;}
    const timer = setTimeout(() => setTick((value) => value + 1), remaining);
    return () => clearTimeout(timer);
  }, [until, remaining]);

  if (remaining <= 0) {return null;}
  return <Ring remainingMs={remaining} />;
};

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 10,
  },
});

export default BubbleHighlight;
