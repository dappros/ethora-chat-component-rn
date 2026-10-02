import React, { ReactNode, useCallback, useEffect, useRef } from 'react';
import {
  BackHandler,
  Keyboard,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  COMPLETE_DISTANCE,
  COMPLETE_VELOCITY,
  EDGE_WIDTH,
  LIST_DIM,
  POP,
  PUSH,
} from '../../MainComponents/RoomStack';

interface SwipeBackLayerProps {
  /** Called once the screen has left (swipe, back button, hardware back). */
  onClose: () => void;
  /** Receives the animated close, to hand to the screen's own back button. */
  children: (close: () => void) => ReactNode;
}

/**
 * Full-screen modal layer with the same navigation feel as RoomStack: it
 * slides in from the right, and a swipe from the left edge drags it back
 * out over whatever is underneath (the room or the list).
 */
export const SwipeBackLayer: React.FC<SwipeBackLayerProps> = ({
  onClose,
  children,
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const width = useSharedValue(windowWidth);
  const x = useSharedValue(windowWidth);
  const closing = useSharedValue(false);

  useEffect(() => {
    x.value = withTiming(0, PUSH);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const finish = useCallback(() => onCloseRef.current(), []);

  const close = useCallback(() => {
    if (closing.value) {
      return;
    }
    closing.value = true;
    Keyboard.dismiss();
    x.value = withTiming(width.value, POP, finished => {
      if (finished) {
        runOnJS(finish)();
      }
    });
  }, [finish]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  const swipeBack = Gesture.Pan()
    .hitSlop({ left: 0, width: EDGE_WIDTH })
    .activeOffsetX(12)
    .failOffsetY([-16, 16])
    .onStart(() => {
      runOnJS(dismissKeyboard)();
    })
    .onUpdate(e => {
      if (closing.value) {
        return;
      }
      x.value = Math.min(Math.max(e.translationX, 0), width.value);
    })
    .onEnd(e => {
      if (closing.value) {
        return;
      }
      const complete =
        x.value > width.value * COMPLETE_DISTANCE ||
        e.velocityX > COMPLETE_VELOCITY;
      if (complete) {
        closing.value = true;
        x.value = withTiming(width.value, POP, finished => {
          if (finished) {
            runOnJS(finish)();
          }
        });
      } else {
        x.value = withTiming(0, POP);
      }
    });

  const screenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, width.value], [LIST_DIM, 0]),
  }));

  return (
    <View
      pointerEvents="box-none"
      style={styles.host}
      onLayout={e => {
        const next = e.nativeEvent.layout.width;
        if (next > 0) {
          width.value = next;
        }
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, styles.dim, dimStyle]}
      />
      <GestureDetector gesture={swipeBack}>
        <Animated.View style={[styles.fill, styles.screen, screenStyle]}>
          {children(close)}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dim: {
    backgroundColor: '#000',
  },
  // Same box the shared ModalBackground gives its content.
  screen: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
});
