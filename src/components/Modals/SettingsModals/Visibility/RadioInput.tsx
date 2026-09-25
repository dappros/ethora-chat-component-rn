import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../../hooks/useTheme';

interface RadioInputProps {
  option: { label: string; value?: boolean };
  checked: boolean;
  onChange: (value?: boolean) => void;
  radioColor?: string;
}

export const RadioInput: React.FC<RadioInputProps> = ({
  option,
  checked,
  onChange,
  radioColor,
}) => {
  const theme = useTheme();
  const color = radioColor || theme.primary;
  return (
    <View style={styles.container}>
      <TouchableOpacity
        key={option.label}
        style={styles.radioContainer}
        onPress={() => onChange(option.value)}
      >
        <View
          style={[
            styles.radioCircle,
            {
              borderColor: color,
              backgroundColor: checked ? color : 'transparent',
            },
          ]}
        />
        <Text style={[styles.radioLabel, { color: theme.text }]}>
          {option.label}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
  },
  radioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    marginRight: 10,
  },
  radioLabel: {
    fontSize: 16,
  },
});
