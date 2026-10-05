import React, { FC } from 'react';
import { ViewProps } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

interface KeyboardInputDockProps extends ViewProps {
  // Bottom padding while the keyboard is closed (the safe-area inset).
  closedPadding: number;
  // Bottom padding while the keyboard is open.
  openedPadding: number;
}

/**
 * Input dock for the KeyboardAvoidingView strategy on iOS. The dock's
 * safe-area padding is only needed while the keyboard is closed; with the
 * keyboard open it collapses in sync with the keyboard animation, so the
 * composer sits right on top of the keyboard instead of leaving a band of
 * dock (or chat background) between them.
 */
export const KeyboardInputDock: FC<KeyboardInputDockProps> = ({
  closedPadding,
  openedPadding,
  style,
  children,
  ...rest
}) => {
  const { progress } = useReanimatedKeyboardAnimation();
  const animatedStyle = useAnimatedStyle(
    () => ({
      paddingBottom: interpolate(
        progress.value,
        [0, 1],
        [closedPadding, openedPadding]
      ),
    }),
    [closedPadding, openedPadding]
  );

  return (
    <Animated.View {...rest} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
};
