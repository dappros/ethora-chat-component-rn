import React, {useEffect, useRef} from 'react';
import {View, StyleSheet, Animated} from 'react-native';

const RecordingIndicator = () => {
  const scaleAnim = useRef(new Animated.Value(1)).current; // For scaling the circle
  const opacityAnim = useRef(new Animated.Value(1)).current; // For pulsating effect

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.3,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.6,
            duration: 750,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ).start();
  }, [scaleAnim, opacityAnim]);

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[
          styles.outerCircle,
          {
            transform: [{scale: scaleAnim}],
            opacity: opacityAnim,
          },
        ]}
      />
      <View style={styles.innerCircle} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  outerCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 0, 0, 0.6)',
    position: 'absolute',
  },
  innerCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'red',
    position: 'relative',
  },
});

export default RecordingIndicator;
