/* eslint-disable react-hooks/rules-of-hooks -- pre-existing port artifacts; hooks called conditionally / inside helpers. TODO: refactor */
// CustomTypingIndicator.native.tsx
import React, { FC, useEffect, useMemo, useRef } from 'react';
import styled, { css } from 'styled-components/native';
import {
  Animated,
  Easing,
  StyleProp,
  ViewStyle,
  View,
  Text,
} from 'react-native';

/* -------- Types -------- */
export interface CustomTypingIndicatorProps {
  usersTyping: string[];
  text?: string | ((usersTyping: string[]) => string);
  position?: 'bottom' | 'top' | 'overlay' | 'floating';
  styles?: StyleProp<ViewStyle>; // RN-эквивалент CSSProperties
  customComponent?: React.ComponentType<{
    usersTyping: string[];
    text: string;
    isVisible: boolean;
  }>;
  isVisible: boolean;
}

/* -------- Helpers (texts) -------- */
export const generateDefaultText = (usersTyping: string[]): string => {
  if (usersTyping.length === 0) {return '';}
  if (usersTyping.length === 1) {return `${usersTyping[0]} is typing`;}
  if (usersTyping.length === 2)
    {return `${usersTyping[0]} and ${usersTyping[1]} are typing`;}
  return `${usersTyping.length} people are typing`;
};

export const generateProcessingText = (usersTyping: string[]): string => {
  if (usersTyping.length === 0) {return '';}
  const processingStates = ['processing', 'thinking', 'generating answer'];
  const randomState =
    processingStates[Math.floor(Math.random() * processingStates.length)];
  if (usersTyping.length === 1) {return `${usersTyping[0]} is ${randomState}`;}
  if (usersTyping.length === 2)
    {return `${usersTyping[0]} and ${usersTyping[1]} are ${randomState}`;}
  return `${usersTyping.length} people are ${randomState}`;
};

/* -------- Styled (static layout) -------- */

const BaseWrapper = styled.View<{ $position: NonNullable<CustomTypingIndicatorProps['position']> }>`
  flex-direction: row;
  align-items: center;
  z-index: 1000;
  /* основная типографика */
  /* (цвета текста задаём на текстовых нодах) */

  ${({ $position }) => {
    switch ($position) {
      case 'top':
        return css`
          position: absolute;
          top: 8px;
          left: 16px;
          right: 16px;
          background-color: rgba(255, 255, 255, 0.95);
          padding: 8px 12px;
          border-radius: 8px;
          /* тени (iOS/Android) */
          shadow-color: #000;
          shadow-opacity: 0.1;
          shadow-radius: 8px;
          shadow-offset: 0px 2px;
          elevation: 3;
        `;
      case 'overlay':
        // В RN нет position: fixed, используем absolute + центрирование
        return css`
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          align-items: center;
          justify-content: center;
          background-color: rgba(0, 0, 0, 0.4); /* лёгкая вуаль */
          padding: 16px 24px;
        `;
      case 'floating':
        return css`
          position: absolute;
          right: 20px;
          bottom: 80px;
          background-color: rgba(255, 255, 255, 0.95);
          padding: 12px 16px;
          border-radius: 20px;
          shadow-color: #000;
          shadow-opacity: 0.15;
          shadow-radius: 12px;
          shadow-offset: 0px 4px;
          elevation: 4;
        `;
      case 'bottom':
      default:
        return css`
          /* встроенное расположение в потоке */
          padding: 8px 0;
        `;
    }
  }}
`;

const Label = styled.Text`
  margin-right: 8px;
  font-weight: 500;
  font-size: 14px;
  color: #555;
`;

const DotsRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

/* -------- Animated helpers -------- */

// pulse для wrapper'ов overlay/floating (scale + opacity)
const usePulse = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.05,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.8,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return { scale, opacity };
};

// мигание одной точки
const useBlink = (delay = 0) => {
  const o = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, {
          toValue: 1,
          duration: 300,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(o, {
          toValue: 0.2,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [o, delay]);
  return o;
};

/* Точка — как View (а не текст), чтобы выглядело одинаково на iOS/Android */
const DotView = styled(Animated.View)`
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: #666;
  margin-right: 2px;
`;

/* -------- Component -------- */

const CustomTypingIndicator: FC<CustomTypingIndicatorProps> = ({
  usersTyping = [],
  text,
  position = 'bottom',
  styles,
  customComponent: CustomComponent,
  isVisible = true,
}) => {
  if (!isVisible || usersTyping.length === 0) {return null;}

  const displayText = useMemo(() => {
    if (typeof text === 'function') {return text(usersTyping);}
    if (typeof text === 'string') {return text;}
    return generateDefaultText(usersTyping);
  }, [text, usersTyping]);

  // Анимации
  const pulse = usePulse();
  const o1 = useBlink(0);
  const o2 = useBlink(200);
  const o3 = useBlink(400);

  if (CustomComponent) {
    return (
      <CustomComponent
        usersTyping={usersTyping}
        text={displayText}
        isVisible={isVisible}
      />
    );
  }

  // Для overlay/floating оборачиваем в Animated.View, чтобы дать pulse
  const WrapperComponent =
    position === 'overlay' || position === 'floating'
      ? Animated.View
      : View;

  const animatedStyle =
    position === 'overlay' || position === 'floating'
      ? { transform: [{ scale: pulse.scale }], opacity: pulse.opacity }
      : null;

  return (
    <WrapperComponent style={animatedStyle as any}>
      <BaseWrapper $position={position} style={styles}>
        <Label>{displayText}</Label>
        <DotsRow>
          <DotView style={{ opacity: o1 }} />
          <DotView style={{ opacity: o2 }} />
          <DotView style={{ opacity: o3 }} />
        </DotsRow>
      </BaseWrapper>
    </WrapperComponent>
  );
};

export default CustomTypingIndicator;