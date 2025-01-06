import styled from "styled-components/native";
import { Animated } from "react-native";
import { Easing } from "react-native-reanimated";
import { useEffect } from "react";

interface LoaderProps {
  size?: number;
  color?: string;
}

const LoaderContainer = styled.View<LoaderProps>`
  width: 100%;
  justify-content: center;
  align-items: center;
`;

const LoaderCircle = styled.View<LoaderProps>`
  width: ${({ size }) => size || 32}px;
  height: ${({ size }) => size || 32}px;
  border-width: ${({ size }) => (size ? size / 12 : 3)}px;
  border-top-color: ${({ color }) => color || "#3498db"};
  border-radius: ${({ size }) => (size || 32) / 2}px;
`;

export default function Loader({ size = 32, color }: LoaderProps) {
  const spin = new Animated.Value(0);

  const startAnimation = () => {
    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  };

  const spinAnimation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  useEffect(() => {
    startAnimation();
  }, []);

  return (
    <LoaderContainer>
      <Animated.View
        style={{
          transform: [{ rotate: spinAnimation }],
        }}
      >
        <LoaderCircle size={size} color={color} />
      </Animated.View>
    </LoaderContainer>
  );
}
