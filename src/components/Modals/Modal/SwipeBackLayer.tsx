import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
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
 * out over whatever is underneath (the room or the list). Like RoomStack it
 * runs on RN's own `Animated`, one value driving every layer.
 */
export const SwipeBackLayer: React.FC<SwipeBackLayerProps> = ({
  onClose,
  children,
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const x = useRef(new Animated.Value(windowWidth)).current;
  const closing = useRef(false);

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

  useEffect(() => {
    slideTo(0, PUSH);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [closeCount, setCloseCount] = useState(0);
  const finish = useCallback(() => {
    onCloseRef.current();
    setCloseCount(count => count + 1);
  }, []);

  // `onClose` normally unmounts this layer. If it is still here afterwards
  // (the modal did not close), slide the screen back rather than leave it
  // parked off-screen.
  useEffect(() => {
    if (closeCount === 0) {
      return;
    }
    closing.current = false;
    slideTo(0, POP);
  }, [closeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const slideOut = useCallback(() => {
    closing.current = true;
    slideTo(widthRef.current, POP, finished => {
      if (finished) {
        finish();
      } else {
        closing.current = false;
      }
    });
  }, [finish, slideTo]);

  const close = useCallback(() => {
    if (closing.current) {
      return;
    }
    Keyboard.dismiss();
    slideOut();
  }, [slideOut]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

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
            slideTo(0, POP);
          }
        }),
    [slideOut, slideTo, x]
  );

  const dimOpacity = useMemo(
    () =>
      x.interpolate({
        inputRange: [0, width],
        outputRange: [LIST_DIM, 0],
        extrapolate: 'clamp',
      }),
    [x, width]
  );

  return (
    <View
      pointerEvents="box-none"
      style={styles.host}
      onLayout={e => {
        const next = e.nativeEvent.layout.width;
        if (next > 0 && next !== widthRef.current) {
          setWidth(next);
        }
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, styles.dim, { opacity: dimOpacity }]}
      />
      <GestureDetector gesture={swipeBack}>
        <Animated.View
          style={[
            styles.fill,
            styles.screen,
            { transform: [{ translateX: x }] },
          ]}
        >
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
