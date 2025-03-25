import React from 'react';
import {StyleSheet, TouchableOpacity, View, Text} from 'react-native';
import {DrawerActions, useNavigation} from '@react-navigation/native';
import ArrowBack from '../../assets/ArrowBack.svg';

export const RenderCustomHeaderAccount = () => {
  const navigation = useNavigation();

  return (
    <View style={styles.headerContainer}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.buttonArrow}>
        <ArrowBack />
      </TouchableOpacity>
      <View style={styles.textContainer}>
        <Text style={styles.text}>Menu</Text>
      </View>
      <View style={styles.rightSpace} />
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    borderBottomColor: '#F5F5F5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    width: '100%',
    height: '100%',
  },
  buttonArrow: {
    width: 24,
    aspectRatio: 1 / 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#53575A',
    fontWeight: '900',
    fontSize: 24,
  },
  rightSpace: {
    width: 24,
  },
});
