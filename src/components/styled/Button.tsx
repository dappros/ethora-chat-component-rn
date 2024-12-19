import React, {ReactElement} from 'react';
import styled from 'styled-components/native';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Loader from './Loader';
import {getTintedColor} from '../../helpers/getTintedColor';

const CustomButton = styled(TouchableOpacity)<{
  disabled: boolean;
  backgroundColor?: string;
  unstyled?: boolean;
  variant?: 'default' | 'filled' | 'outlined';
}>`
  border-width: ${({variant}) => (variant === 'outlined' ? 1 : 0)}px;
  border-color: ${({backgroundColor}) => backgroundColor || '#0052CD'};
  border-radius: 16px;
  background-color: ${({variant, backgroundColor}) =>
    variant === 'filled' ? backgroundColor || '#0052CD' : 'transparent'};
  justify-content: center;
  align-items: center;
  height: 40px;
  padding-horizontal: 12px;
  flex-direction: row;
  opacity: ${({disabled}) => (disabled ? 0.6 : 1)};
`;

const ButtonText = styled.Text<{
  variant?: 'default' | 'filled' | 'outlined';
  backgroundColor?: string;
}>`
  color: ${({variant, backgroundColor}) =>
    variant === 'filled' ? '#FFFFFF' : backgroundColor || '#0052CD'};
  font-size: 14px;
  font-weight: bold;
`;

interface ButtonProps {
  text?: string | ReactElement;
  EndIcon?: ReactElement;
  StartIcon?: ReactElement;
  loading?: boolean;
  disabled?: boolean;
  unstyled?: boolean;
  variant?: 'default' | 'filled' | 'outlined';
  backgroundColor?: string;
  onPress?: () => void;
  children?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  text,
  EndIcon,
  loading = false,
  disabled = false,
  unstyled = false,
  variant = 'default',
  backgroundColor,
  onPress,
  StartIcon,
  children,
}) => {
  return (
    <CustomButton
      disabled={disabled || loading}
      onPress={onPress}
      variant={variant}
      backgroundColor={backgroundColor}>
      {loading && <Loader size={24} />}
      {!loading && StartIcon && <View style={styles.icon}>{StartIcon}</View>}
      {!loading &&
        (children || (
          <ButtonText variant={variant} backgroundColor={backgroundColor}>
            {text}
          </ButtonText>
        ))}
      {!loading && EndIcon && <View style={styles.icon}>{EndIcon}</View>}
    </CustomButton>
  );
};

const styles = StyleSheet.create({
  icon: {
    marginHorizontal: 4,
  },
});

export default Button;
