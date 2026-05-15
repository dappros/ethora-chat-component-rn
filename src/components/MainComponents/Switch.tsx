import React, { useCallback, useRef, useState } from 'react';
import { Animated } from 'react-native';
import styled from 'styled-components/native';

const SwitchContainer = styled.Pressable<{ isOn: boolean; bgColor?: string }>`
  width: 34px;
  height: 18px;
  background-color: ${({ isOn, bgColor }) =>
    isOn ? (bgColor ? bgColor : '#0056d2') : '#8C8C8C'};
  border-radius: 100px;
  display: flex;
  transition: background-color 0.3s;
  padding: 2px;
`;

const Toggle = styled(Animated.View)`
  width: 15px;
  height: 15px;
  background-color: white;
  border-radius: 100px;
`;

interface SwitchProps {
  onToggle: (isOn: boolean) => void;
  bgColor?: string;
  onSwitchOn?: () => void;
  onSwitchOff?: () => void;
}

const Switch: React.FC<SwitchProps> = ({
  onSwitchOn,
  onSwitchOff,
  onToggle,
  bgColor,
}) => {
  const [isOn, setIsOn] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;

  const toggleSwitch = () => {
    const nextState = !isOn;

    Animated.timing(translateX, {
      toValue: nextState ? 15 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    if (nextState) {
      onSwitchOn?.();
    } else {
      onSwitchOff?.();
    }

    setIsOn(nextState);
    onToggle(nextState);
  };

  return (
    <SwitchContainer
      isOn={isOn}
      onPress={toggleSwitch}
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn }}
      accessibilityLabel="Toggle switch"
      accessibilityHint="Double tap to toggle on or off"
      bgColor={bgColor}
    >
      <Toggle style={{ transform: [{ translateX }] }} />
    </SwitchContainer>
  );
};

export default Switch;
