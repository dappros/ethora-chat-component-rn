import React, { useEffect } from 'react';
import { View, Image, StyleSheet, Text, Animated, Easing } from 'react-native';
import SplashScreen from 'react-native-splash-screen';
import Loading from '../assets/Loading.svg';
import Svg, { Circle } from 'react-native-svg';

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

const CustomSplashScreen = () => {
  const spinValue = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      })
    );
    spinAnimation.start();
  }, [spinValue]);
  
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  useEffect(() => {
      SplashScreen.hide();
  }, []);

  return (
    <View style={styles.container}>
      <Image source={require('../assets/launch_screen.png')} style={styles.background} />
      <View style={styles.spin}>
        <AnimatedSvg
          width={60}
          height={60}
          style={{ transform: [{ rotate: spin }] }}
        >
          <Loading width="100%" height="100%" />
        </AnimatedSvg>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    position: 'relative',
  },
  background: {
    width: '100%',
    height: '100%'
  },
  spin: {
    position: 'absolute',
    bottom: 115,
    justifyContent: 'center'
  },
});

export default CustomSplashScreen;
