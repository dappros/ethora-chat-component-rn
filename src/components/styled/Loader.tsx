import styled from 'styled-components/native';
import {Animated} from 'react-native';
import {Easing} from 'react-native-reanimated';

const spin = new Animated.Value(0);

Animated.loop(
  Animated.timing(spin, {
    toValue: 1,
    duration: 2000,
    easing: Easing.linear,
    useNativeDriver: true,
  }),
).start();

const spinAnimation = spin.interpolate({
  inputRange: [0, 1],
  outputRange: ['0deg', '360deg'],
});

interface LoaderProps {
  size?: number;
  color?: string;
}

const LoaderContainer = styled.View<LoaderProps>`
  justify-content: center;
  align-items: center;
  width: ${({size}) => (size || 32) + 4}px;
  height: ${({size}) => (size || 32) + 4}px;
`;

const LoaderCircle = styled.View<LoaderProps>`
  width: ${({size}) => size || 32}px;
  height: ${({size}) => size || 32}px;
  border-width: ${({size}) => (size ? size / 8 : 4)}px;
  border-color: #f3f3f3;
  border-top-color: ${({color}) => color || '#3498db'};
  border-radius: ${({size}) => (size || 32) / 2}px;
`;

export default function Loader({size, color}: LoaderProps) {
  return (
    <LoaderContainer size={size}>
      <Animated.View
        style={{
          transform: [{rotate: spinAnimation}],
        }}>
        <LoaderCircle size={size} color={color} />
      </Animated.View>
    </LoaderContainer>
  );
}
