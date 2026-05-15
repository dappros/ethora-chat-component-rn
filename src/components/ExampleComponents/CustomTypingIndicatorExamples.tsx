/* eslint-disable react-hooks/rules-of-hooks -- pre-existing port artifacts; hooks called conditionally / inside helpers. TODO: refactor */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import styled from 'styled-components/native';

type Props = {
  usersTyping?: string[];
  text: string;
  isVisible: boolean;
};

const AIWrapper = styled.View`
  flex-direction: row;
  align-items: center;
  background-color: #667eea; /* можно заменить на градиент через rn-linear-gradient */
  padding: 12px 20px;
  border-radius: 25px;

  /* тень iOS */
  shadow-color: #667eea;
  shadow-opacity: 0.3;
  shadow-offset: 0px 4px;
  shadow-radius: 10px;

  /* тень Android */
  elevation: 3;
`;

const AIAvatar = styled.View`
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background-color: rgba(255, 255, 255, 0.2);
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`;

const AIAvatarText = styled.Text`
  color: #fff;
  font-size: 12px;
  font-weight: 600;
`;

const AIText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 500;
`;

const AnimatedAIWrapper = styled(Animated.View)``;

export const AIProcessingIndicator: React.FC<Props> = ({ text, isVisible }) => {
  if (!isVisible) {return null;}

  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.05, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <AnimatedAIWrapper style={{ transform: [{ scale }], opacity }}>
      <AIWrapper>
        <AIAvatar>
          <AIAvatarText>AI</AIAvatarText>
        </AIAvatar>
        <AIText>{text}</AIText>
      </AIWrapper>
    </AnimatedAIWrapper>
  );
};

const MinWrapper = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 8px;
`;

const Dot = styled(Animated.View)`
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: #666;
  margin: 0 2px;
`;

export const MinimalTypingIndicator: React.FC<Props> = ({ isVisible }) => {
  if (!isVisible) {return null;}

  const makeOpacity = (delay: number) => {
    const o = new Animated.Value(0.2);
    useEffect(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(o, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
          Animated.timing(o, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }, []);
    return o;
  };

  const o1 = makeOpacity(0);
  const o2 = makeOpacity(200);
  const o3 = makeOpacity(400);

  return (
    <MinWrapper>
      <Dot style={{ opacity: o1 }} />
      <Dot style={{ opacity: o2 }} />
      <Dot style={{ opacity: o3 }} />
    </MinWrapper>
  );
};

const Bubble = styled.View`
  background-color: #f0f0f0;
  border-radius: 18px;
  padding: 8px 16px;
  margin: 4px 0;
  align-self: flex-start;
  max-width: 240px;
`;

const BubbleText = styled.Text`
  font-size: 14px;
  color: #666;
`;

const BubbleTail = styled.View`
  position: absolute;
  bottom: -6px;
  left: 20px;
  width: 0px;
  height: 0px;
  border-left-width: 6px;
  border-right-width: 6px;
  border-top-width: 6px;
  border-left-color: transparent;
  border-right-color: transparent;
  border-top-color: #f0f0f0;
`;

const BubbleWrapper = styled.View`
  position: relative;
  align-self: flex-start;
`;

export const ChatBubbleTypingIndicator: React.FC<Props> = ({ text, isVisible }) => {
  if (!isVisible) {return null;}

  return (
    <BubbleWrapper>
      <Bubble>
        <BubbleText>{text}</BubbleText>
      </Bubble>
      <BubbleTail />
    </BubbleWrapper>
  );
};

const ProgressWrap = styled.View`
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  padding: 8px 16px;
  flex-direction: row;
  align-items: center;
`;

const ProgressLabel = styled.Text`
  font-size: 12px;
  color: #666;
  margin-right: 8px;
`;

const Bar = styled.View`
  width: 60px;
  height: 4px;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 2px;
  overflow: hidden;
`;

const Runner = styled(Animated.View)`
  width: 60px;
  height: 4px;
  background-color: #007bff;
`;

export const ProgressTypingIndicator: React.FC<Props> = ({ text, isVisible }) => {
  if (!isVisible) {return null;}

  const tx = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tx, { toValue: 60, duration: 1500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(tx, { toValue: -60, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tx]);

  return (
    <ProgressWrap>
      <ProgressLabel>{text}</ProgressLabel>
      <Bar>
        <Runner style={{ transform: [{ translateX: tx }] }} />
      </Bar>
    </ProgressWrap>
  );
};

export const CustomTypingIndicatorExamples = {
  AIProcessingIndicator,
  MinimalTypingIndicator,
  ChatBubbleTypingIndicator,
  ProgressTypingIndicator,
};