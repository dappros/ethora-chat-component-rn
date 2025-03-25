import React, {useState, useEffect, useRef} from 'react';
import {Keyboard, Animated} from 'react-native';
import {heightPercentageToDP as hp} from 'react-native-responsive-screen';

export const useKeyboardAnimation = (
  translateValue = 0.05,
  translateDuration = 300,
  opacityDuration = 150,
) => {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const screenHeight = hp('100%');
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      () => {
        setIsKeyboardVisible(true);
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: opacityDuration,
          useNativeDriver: true,
        }).start();

        Animated.timing(translateYAnim, {
          toValue: -screenHeight * translateValue,
          duration: translateDuration,
          useNativeDriver: true,
        }).start();
      },
    );

    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        setIsKeyboardVisible(false);
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start();

        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      },
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, [translateYAnim, opacityAnim, screenHeight]);

  return {translateYAnim, opacityAnim, isKeyboardVisible};
};

export const KeyboardAnimated = ({children, type = 'translate'}) => {
  const {translateYAnim, opacityAnim} = useKeyboardAnimation();

  const animatedStyle =
    type === 'translate'
      ? {transform: [{translateY: translateYAnim}]}
      : {opacity: opacityAnim};

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
};
