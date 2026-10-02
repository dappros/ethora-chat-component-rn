import React, {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  BackHandler,
  Keyboard,
  LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Width of the left-edge strip that starts the back swipe.
export const EDGE_WIDTH = 28;
// Released past this share of the width (or faster than the velocity
// below), the swipe completes; otherwise the room settles back.
export const COMPLETE_DISTANCE = 0.35;
export const COMPLETE_VELOCITY = 600;
// How far the list underneath is shifted left while fully covered.
const LIST_PARALLAX = 0.3;
export const LIST_DIM = 0.25;

export const PUSH = { duration: 320, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
export const POP = { duration: 240, easing: Easing.out(Easing.cubic) };

export interface RoomStackHandle {
  /** Slide the room out, then call `onBack`. */
  pop: () => void;
}

interface RoomStackProps {
  /** The room list — stays mounted under the room so it is there to reveal. */
  list: ReactNode;
  /** The open room, or null while only the list is shown. */
  room: ReactNode | null;
  /** Called once the room has left the screen (swipe, back button, pop()). */
  onBack: () => void;
  /** Background behind the room's content. */
  roomBackground?: string;
  /** Android hardware back / system back gesture returns to the list. */
  hardwareBack?: boolean;
}

/**
 * Two-layer stack for the list → room navigation: the room slides in over
 * the list, and a swipe from the left edge drags it back out, following the
 * finger, with the list parallaxing in underneath (the iOS navigation feel).
 */
export const RoomStack = forwardRef<RoomStackHandle, RoomStackProps>(
  ({ list, room, onBack, roomBackground, hardwareBack = true }, ref) => {
    const { width: windowWidth } = useWindowDimensions();
    const width = useSharedValue(windowWidth);
    const hasRoom = !!room;
    // Room's horizontal offset: 0 = covering the list, `width` = off-screen.
    // A room already open on the first render is shown in place.
    const x = useSharedValue(hasRoom ? 0 : windowWidth);
    const closing = useSharedValue(false);

    const isFirstRender = useRef(true);
    useEffect(() => {
      if (isFirstRender.current) {
        isFirstRender.current = false;
        return;
      }
      closing.value = false;
      if (hasRoom) {
        x.value = width.value;
        x.value = withTiming(0, PUSH);
      } else {
        x.value = width.value;
      }
    }, [hasRoom]); // eslint-disable-line react-hooks/exhaustive-deps

    const onBackRef = useRef(onBack);
    onBackRef.current = onBack;
    const finish = useCallback(() => onBackRef.current(), []);

    const pop = useCallback(() => {
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

    useImperativeHandle(ref, () => ({ pop }), [pop]);

    useEffect(() => {
      if (!hasRoom || !hardwareBack) {
        return undefined;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        pop();
        return true;
      });
      return () => sub.remove();
    }, [hasRoom, hardwareBack, pop]);

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

    const onLayout = useCallback((e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.width;
      if (next > 0 && next !== width.value) {
        // Keep an off-screen room off-screen when the container resizes.
        if (x.value === width.value) {
          x.value = next;
        }
        width.value = next;
      }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const roomStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: x.value }],
    }));
    // 1 while the room fully covers the list, 0 once it is gone.
    const listStyle = useAnimatedStyle(() => {
      const covered = 1 - Math.min(Math.max(x.value / width.value, 0), 1);
      return {
        transform: [{ translateX: -width.value * LIST_PARALLAX * covered }],
      };
    });
    const dimStyle = useAnimatedStyle(() => ({
      opacity: interpolate(x.value, [0, width.value], [LIST_DIM, 0]),
    }));

    return (
      <View style={styles.container} onLayout={onLayout}>
        <Animated.View
          style={[styles.layer, listStyle]}
          pointerEvents={hasRoom ? 'none' : 'auto'}
          accessibilityElementsHidden={hasRoom}
          importantForAccessibility={hasRoom ? 'no-hide-descendants' : 'auto'}
        >
          {list}
        </Animated.View>
        {hasRoom && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.layer, styles.dim, dimStyle]}
            />
            <GestureDetector gesture={swipeBack}>
              <Animated.View
                style={[
                  styles.layer,
                  styles.room,
                  { backgroundColor: roomBackground },
                  roomStyle,
                ]}
              >
                {room}
              </Animated.View>
            </GestureDetector>
          </>
        )}
      </View>
    );
  }
);

RoomStack.displayName = 'RoomStack';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dim: {
    backgroundColor: '#000',
  },
  room: {
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
});
