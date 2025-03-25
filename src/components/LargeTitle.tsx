import React from 'react';
import {StyleProp, StyleSheet, Text, TextStyle} from 'react-native';
import {textStyles} from '../config/config';

export interface ILargeTitle {
  text: string;
  style?: StyleProp<TextStyle>;
}

export const LargeTitle: React.FC<ILargeTitle> = ({text, style}) => {
  return <Text style={[styles.text, style]}>{text}</Text>;
};

const styles = StyleSheet.create({
  text: {
    fontSize: 28,
    color: 'black',
    fontWeight: '700',
    fontFamily: textStyles.boldFont,
  },
});
