import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View, StyleProp, ViewStyle } from 'react-native';

interface LinearGradientButtonProps {
  loading?: boolean;
  onPress: () => void;
  title?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  disabled?: boolean;
}

const LinearGradientButton: React.FC<LinearGradientButtonProps> = ({
  loading = false,
  onPress,
  title,
  style,
  children,
  disabled = false,
}) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        { 
          padding: 10, 
          backgroundColor: disabled || loading ? 'gray' : '#2962FF',
          justifyContent: 'center', 
          alignItems: 'center', 
          borderRadius: 30,
          height: 56
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="white" />
      ) : (
        children || <Text style={{ color: 'white' }}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

export { LinearGradientButton };
