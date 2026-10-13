import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, PanResponder } from 'react-native';

/**
 * The small video tile of a call, Telegram-style: drag it anywhere and it
 * snaps to the nearest corner when released (a flick carries it towards
 * the flick), pinch it to switch between a small and a large size.
 *
 * Positions are kept per corner rather than per pixel, so the tile stays
 * glued to its corner when the stage changes size (rotation, iPad split
 * view) or the tile itself changes size.
 */

export type PipTileSize = 'small' | 'large';

export const PIP_TILE_SIZES: Record<PipTileSize, { width: number; height: number }> = {
  small: { width: 104, height: 148 },
  large: { width: 156, height: 222 },
};

const MARGIN = 12;
// How far a flick carries the tile before picking a corner, in ms of velocity.
const FLICK_PROJECTION_MS = 160;
// Pinch past these ratios to change size; in between keeps the current one.
const GROW_RATIO = 1.12;
const SHRINK_RATIO = 0.9;

interface Corner {
  right: boolean;
  bottom: boolean;
}

interface Stage {
  width: number;
  height: number;
}

const SPRING = { useNativeDriver: false, damping: 20, stiffness: 220, mass: 0.8 };

const touchDistance = (touches: ReadonlyArray<{ pageX: number; pageY: number }>) => {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

export const usePipTile = ({ topInset = 0 }: { topInset?: number } = {}) => {
  const [stage, setStage] = useState<Stage | null>(null);
  const [size, setSize] = useState<PipTileSize>('small');
  const stageRef = useRef<Stage | null>(null);
  const sizeRef = useRef<PipTileSize>('small');
  const cornerRef = useRef<Corner>({ right: true, bottom: false });
  const topInsetRef = useRef(topInset);
  topInsetRef.current = topInset;

  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const width = useRef(new Animated.Value(PIP_TILE_SIZES.small.width)).current;
  const height = useRef(new Animated.Value(PIP_TILE_SIZES.small.height)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  // Where the tile rests, i.e. where a drag starts from.
  const restRef = useRef({ x: 0, y: 0 });
  const gestureRef = useRef({ pinching: false, startDistance: 0, scale: 1 });

  const cornerPoint = useCallback((corner: Corner, tileSize: PipTileSize) => {
    const area = stageRef.current;
    if (!area) {return { x: 0, y: 0 };}
    const tile = PIP_TILE_SIZES[tileSize];
    const top = MARGIN + topInsetRef.current;
    return {
      x: corner.right ? Math.max(MARGIN, area.width - tile.width - MARGIN) : MARGIN,
      y: corner.bottom ? Math.max(top, area.height - tile.height - MARGIN) : top,
    };
  }, []);

  const settle = useCallback(
    (animated: boolean) => {
      const tileSize = sizeRef.current;
      const target = cornerPoint(cornerRef.current, tileSize);
      const tile = PIP_TILE_SIZES[tileSize];
      restRef.current = target;
      if (!animated) {
        position.setValue(target);
        width.setValue(tile.width);
        height.setValue(tile.height);
        pinchScale.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.spring(position, { ...SPRING, toValue: target }),
        Animated.spring(width, { ...SPRING, toValue: tile.width }),
        Animated.spring(height, { ...SPRING, toValue: tile.height }),
        Animated.spring(pinchScale, { ...SPRING, toValue: 1 }),
      ]).start();
    },
    [cornerPoint, position, width, height, pinchScale]
  );

  const onStageLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width: w, height: h } = event.nativeEvent.layout;
      const prev = stageRef.current;
      if (prev && prev.width === w && prev.height === h) {return;}
      stageRef.current = { width: w, height: h };
      setStage(stageRef.current);
      settle(false);
    },
    [settle]
  );

  // The safe-area inset arrives after the first layout on some devices.
  useEffect(() => {
    if (stageRef.current) {settle(false);}
  }, [topInset, settle]);

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        // Two fingers are always ours (pinch); one finger only once it
        // moves, so a tap still reaches the tile's onPress (swap videos).
        onStartShouldSetPanResponderCapture: (event) =>
          event.nativeEvent.touches.length >= 2,
        // Own the touch from the start when the tile has no tap target
        // (nothing to swap): an ancestor outside the call Modal would take
        // it otherwise, and the move-capture below would never be asked.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: (event, gesture) =>
          event.nativeEvent.touches.length >= 2 ||
          Math.abs(gesture.dx) > 4 ||
          Math.abs(gesture.dy) > 4,
        // Never hand the tile over to the swipe-to-minimize of the screen.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          position.stopAnimation();
          width.stopAnimation();
          height.stopAnimation();
          pinchScale.stopAnimation();
          gestureRef.current = { pinching: false, startDistance: 0, scale: 1 };
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          const state = gestureRef.current;
          if (touches.length >= 2) {
            const distance = touchDistance(touches);
            if (!state.pinching || state.startDistance <= 0) {
              state.pinching = true;
              state.startDistance = distance;
            } else {
              state.scale = Math.min(1.8, Math.max(0.6, distance / state.startDistance));
              pinchScale.setValue(state.scale);
            }
          }
          position.setValue({
            x: restRef.current.x + gesture.dx,
            y: restRef.current.y + gesture.dy,
          });
        },
        onPanResponderRelease: (_event, gesture) => {
          const area = stageRef.current;
          const state = gestureRef.current;
          if (state.pinching) {
            const next: PipTileSize =
              state.scale >= GROW_RATIO
                ? 'large'
                : state.scale <= SHRINK_RATIO
                  ? 'small'
                  : sizeRef.current;
            if (next !== sizeRef.current) {
              // Keep the size the finger left it at, then let the spring
              // carry it to the new one, so the tile doesn't jump.
              const from = PIP_TILE_SIZES[sizeRef.current];
              width.setValue(from.width * state.scale);
              height.setValue(from.height * state.scale);
              pinchScale.setValue(1);
              sizeRef.current = next;
              setSize(next);
            }
          }
          if (area) {
            const tile = PIP_TILE_SIZES[sizeRef.current];
            const centerX =
              restRef.current.x + gesture.dx + gesture.vx * FLICK_PROJECTION_MS + tile.width / 2;
            const centerY =
              restRef.current.y + gesture.dy + gesture.vy * FLICK_PROJECTION_MS + tile.height / 2;
            cornerRef.current = {
              right: centerX > area.width / 2,
              bottom: centerY > area.height / 2,
            };
          }
          settle(true);
        },
        onPanResponderTerminate: () => settle(true),
      }).panHandlers,
    [position, width, height, pinchScale, settle]
  );

  return {
    /** Put on the area the tile moves within. */
    onStageLayout,
    panHandlers,
    size,
    /** Hidden until the stage is measured, so it never flashes at 0,0. */
    style: {
      position: 'absolute' as const,
      left: 0,
      top: 0,
      width,
      height,
      opacity: stage ? 1 : 0,
      transform: [
        { translateX: position.x },
        { translateY: position.y },
        { scale: pinchScale },
      ],
    },
  };
};
