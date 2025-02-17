import React, { useState, useEffect, useRef } from "react";
import { Keyboard, Animated, Platform } from "react-native";

export const useKeyboardAnimation = (
  translateValue = 0.38,
  translateDuration = 50,
  opacityDuration = 50
) => {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      "keyboardDidShow",
      (event) => {
        const height = event.endCoordinates.height;
        setKeyboardHeight(height);

        if (Platform.OS !== "android") {
          setIsKeyboardVisible(true);
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: opacityDuration,
            useNativeDriver: true,
          }).start();

          console.log(height);

          Animated.timing(translateYAnim, {
            toValue: -height + 36,
            duration: translateDuration,
            useNativeDriver: true,
          }).start();
        }
      }
    );

    const keyboardDidHideListener = Keyboard.addListener(
      "keyboardDidHide",
      () => {
        setIsKeyboardVisible(false);
        setKeyboardHeight(0);

        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: translateDuration,
          useNativeDriver: true,
        }).start();

        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: opacityDuration,
          useNativeDriver: true,
        }).start();
      }
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, [translateYAnim, opacityAnim]);

  return { translateYAnim, opacityAnim, isKeyboardVisible, keyboardHeight };
};

export const KeyboardAnimated = ({ children, type = "translate" }) => {
  const { translateYAnim, opacityAnim } = useKeyboardAnimation();

  const animatedStyle =
    type === "translate"
      ? { transform: [{ translateY: translateYAnim }] }
      : { opacity: opacityAnim };

  if (Platform.OS === "android") return <>{children}</>;

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
};
