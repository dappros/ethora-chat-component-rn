import { useMemo, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

/**
 * Drag a floating element around (web's useDraggable, for the self-view
 * tile and the minimized call panel). The offset is kept between drags.
 *
 * The responder only claims the gesture once the finger actually moves a
 * few points, so taps still reach the buttons inside the dragged element.
 */
export const useDraggable = () => {
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const offset = useRef({ x: 0, y: 0 });

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          position.setOffset(offset.current);
          position.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event(
          [null, { dx: position.x, dy: position.y }],
          { useNativeDriver: false }
        ),
        onPanResponderRelease: (_event, gesture) => {
          offset.current = {
            x: offset.current.x + gesture.dx,
            y: offset.current.y + gesture.dy,
          };
          position.flattenOffset();
        },
        onPanResponderTerminate: () => {
          position.flattenOffset();
        },
      }).panHandlers,
    [position]
  );

  return {
    panHandlers,
    style: { transform: position.getTranslateTransform() },
  };
};
