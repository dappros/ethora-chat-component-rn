import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface CheckboxProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  color?: string;
}

/**
 * Minimal RN-native checkbox replacement for the user-list multi-select.
 * Avoids pulling in `@react-native-community/checkbox` (legacy native
 * module that needs the Metro shim) — the UI footprint is one tap-target
 * with a check glyph, so a plain Pressable does the job.
 */
const Checkbox: React.FC<CheckboxProps> = ({
  value,
  onValueChange,
  disabled,
  color = '#0052cd',
}) => {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.box,
        { borderColor: color, backgroundColor: value ? color : 'transparent' },
        disabled && styles.disabled,
      ]}
    >
      {value && (
        <View style={styles.checkInner}>
          <Text style={styles.checkGlyph}>✓</Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  box: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  disabled: {
    opacity: 0.4,
  },
});

export default Checkbox;
