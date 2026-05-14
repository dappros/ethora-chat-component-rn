import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import styled, { css } from 'styled-components/native';

export interface ToastType {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
}

const ToastContainer = styled(Animated.View)<{ type: string }>`
  ${({ type }) => {
    let backgroundColor = '#333';
    switch (type) {
      case 'success':
        backgroundColor = '#4caf50';
        break;
      case 'error':
        backgroundColor = '#f44336';
        break;
      case 'info':
        backgroundColor = '#2196F3';
        break;
    }
    return css`
      background-color: ${backgroundColor};
    `;
  }}
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 8px;
  width: 240px;
  shadow-color: #000;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.2;
  shadow-radius: 4px;
  elevation: 3;
`;

const Title = styled.Text`
  font-weight: bold;
  color: white;
  font-size: 15px;
`;

const Message = styled.Text`
  color: white;
  font-size: 13px;
  margin-top: 4px;
`;

const ProgressBar = styled(Animated.View)`
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background-color: rgba(255, 255, 255, 0.6);
`;

const Toast: React.FC<ToastType> = ({
  title,
  message,
  type,
  duration = 3000,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Анимация появления и исчезновения
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(progressAnim, {
          toValue: 0,
          duration,
          useNativeDriver: false,
        }),
      ]),
      Animated.delay(duration - 300),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 10,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [fadeAnim, translateY, progressAnim, duration]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <ToastContainer
      type={type}
      style={{
        opacity: fadeAnim,
        transform: [{ translateY }],
      }}
    >
      <Title>{title}</Title>
      <Message>{message}</Message>
      <ProgressBar style={{ width: progressWidth }} />
    </ToastContainer>
  );
};

export { Toast };
