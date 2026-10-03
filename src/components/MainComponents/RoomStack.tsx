import React, {
  forwardRef,
  memo,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
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

/**
 * Holds its children still while `frozen`: the list under an open room is
 * fully covered, so re-rendering it on every store update (each incoming
 * message) is wasted work on the JS thread. It thaws as soon as it is
 * about to be seen again.
 */
const Freezable = memo(
  ({ children }: { frozen: boolean; children: ReactNode }) => <>{children}</>,
  (_prev, next) => next.frozen
);

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
 *
 * Driven by RN's own `Animated` (native driver), not Reanimated: every layer
 * derives from ONE value through interpolation, so the layers cannot drift
 * apart, and a React re-render mid-flight cannot reset a layer to the style
 * it was first rendered with.
 */
export const RoomStack = forwardRef<RoomStackHandle, RoomStackProps>(
  ({ list, room, onBack, roomBackground, hardwareBack = true }, ref) => {
    const { width: windowWidth } = useWindowDimensions();
    const [width, setWidth] = useState(windowWidth);
    const widthRef = useRef(width);
    widthRef.current = width;
    const hasRoom = !!room;
    // Room's horizontal offset: 0 = covering the list, `width` = off-screen.
    // A room already open on the first render is shown in place.
    const x = useRef(new Animated.Value(hasRoom ? 0 : windowWidth)).current;
    const closing = useRef(false);

    // True while the list is (about to be) visible under a moving room.
    const [peeking, setPeeking] = useState(false);
    // Bumped after every completed pop — see the settle effect below.
    const [popCount, setPopCount] = useState(0);

    const slideTo = useCallback(
      (
        toValue: number,
        config: typeof PUSH,
        done?: (finished: boolean) => void
      ) => {
        Animated.timing(x, {
          toValue,
          ...config,
          useNativeDriver: true,
        }).start(({ finished }) => done?.(finished));
      },
      [x]
    );

    const isFirstRender = useRef(true);
    useEffect(() => {
      if (isFirstRender.current) {
        isFirstRender.current = false;
        return;
      }
      closing.current = false;
      setPeeking(false);
      x.stopAnimation();
      x.setValue(widthRef.current);
      if (hasRoom) {
        slideTo(0, PUSH);
      }
    }, [hasRoom]); // eslint-disable-line react-hooks/exhaustive-deps

    const onBackRef = useRef(onBack);
    onBackRef.current = onBack;
    const finish = useCallback(() => {
      onBackRef.current();
      setPopCount(count => count + 1);
    }, []);

    // `onBack` normally clears the room, and the effect above takes over.
    // If the room is still (or again) there after a pop — something
    // re-selected it — bring it back on screen: a room parked off-screen
    // would leave the list visible but untouchable.
    const hasRoomRef = useRef(hasRoom);
    hasRoomRef.current = hasRoom;
    useEffect(() => {
      if (popCount === 0 || !hasRoomRef.current) {
        return;
      }
      closing.current = false;
      setPeeking(false);
      slideTo(0, POP);
    }, [popCount]); // eslint-disable-line react-hooks/exhaustive-deps

    const slideOut = useCallback(() => {
      closing.current = true;
      setPeeking(true);
      slideTo(widthRef.current, POP, finished => {
        if (finished) {
          finish();
        } else {
          closing.current = false;
        }
      });
    }, [finish, slideTo]);

    const pop = useCallback(() => {
      if (closing.current) {
        return;
      }
      Keyboard.dismiss();
      slideOut();
    }, [slideOut]);

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

    const swipeBack = useMemo(
      () =>
        Gesture.Pan()
          .runOnJS(true)
          .hitSlop({ left: 0, width: EDGE_WIDTH })
          .activeOffsetX(12)
          .failOffsetY([-16, 16])
          .onStart(() => {
            if (closing.current) {
              return;
            }
            Keyboard.dismiss();
            setPeeking(true);
            x.stopAnimation();
          })
          .onUpdate(e => {
            if (closing.current) {
              return;
            }
            x.setValue(Math.min(Math.max(e.translationX, 0), widthRef.current));
          })
          .onEnd(e => {
            if (closing.current) {
              return;
            }
            const complete =
              e.translationX > widthRef.current * COMPLETE_DISTANCE ||
              e.velocityX > COMPLETE_VELOCITY;
            if (complete) {
              slideOut();
            } else {
              slideTo(0, POP, () => setPeeking(false));
            }
          }),
      [slideOut, slideTo, x]
    );

    const onLayout = useCallback(
      (e: LayoutChangeEvent) => {
        const next = e.nativeEvent.layout.width;
        if (next > 0 && next !== widthRef.current) {
          // Keep an off-screen room off-screen when the container resizes.
          if (!hasRoomRef.current) {
            x.setValue(next);
          }
          setWidth(next);
        }
      },
      [x]
    );

    const { listShift, dimOpacity } = useMemo(
      () => ({
        listShift: x.interpolate({
          inputRange: [0, width],
          outputRange: [-width * LIST_PARALLAX, 0],
          extrapolate: 'clamp',
        }),
        dimOpacity: x.interpolate({
          inputRange: [0, width],
          outputRange: [LIST_DIM, 0],
          extrapolate: 'clamp',
        }),
      }),
      [x, width]
    );

    return (
      <View style={styles.container} onLayout={onLayout}>
        <Animated.View
          style={[
            styles.layer,
            // Without a room the list always rests in place, whatever the
            // animated value is doing.
            hasRoom ? { transform: [{ translateX: listShift }] } : null,
          ]}
          pointerEvents={hasRoom ? 'none' : 'auto'}
          accessibilityElementsHidden={hasRoom}
          importantForAccessibility={hasRoom ? 'no-hide-descendants' : 'auto'}
        >
          <Freezable frozen={hasRoom && !peeking}>{list}</Freezable>
        </Animated.View>
        {hasRoom && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.layer, styles.dim, { opacity: dimOpacity }]}
            />
            <GestureDetector gesture={swipeBack}>
              <Animated.View
                style={[
                  styles.layer,
                  styles.room,
                  { backgroundColor: roomBackground },
                  { transform: [{ translateX: x }] },
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
