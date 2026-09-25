import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';

interface StyledInputProps {
  label?: string;
  color?: string;
  helperText?: string;
  error?: boolean;
  [key: string]: any;
}

const InputWrapper = ({ children }: { children: React.ReactNode }) => {
  return <View style={styles.inputWrapper}>{children}</View>;
};

const Label = ({ children }: { children: React.ReactNode }) => {
  const theme = useTheme();
  return (
    <Text style={[styles.label, { color: theme.textSecondary }]}>{children}</Text>
  );
};

const StyledInput = ({
  color,
  error,
  ...props
}: { color?: string; error?: boolean } & React.ComponentProps<
  typeof TextInput
>) => {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textMuted}
      keyboardAppearance={theme.dark ? 'dark' : 'light'}
      style={[
        styles.input,
        {
          borderColor: error ? 'red' : color || theme.primary,
          backgroundColor: theme.surfaceSecondary,
          color: theme.text,
        },
      ]}
      {...props}
    />
  );
};

const HelperText = ({
  children,
  error,
}: {
  children: React.ReactNode;
  error?: boolean;
}) => {
  const theme = useTheme();
  return (
    <Text
      style={[styles.helperText, { color: error ? 'red' : theme.textSecondary }]}
    >
      {children}
    </Text>
  );
};

const InputWithLabel: React.FC<StyledInputProps> = ({
  label,
  color,
  helperText,
  error,
  ...rest
}) => {
  return (
    <InputWrapper>
      {label && <Label>{label}</Label>}
      <StyledInput color={color} error={error} {...rest} />
      {helperText && <HelperText error={error}>{helperText}</HelperText>}
    </InputWrapper>
  );
};

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'column',
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    position: 'relative',
    height: 48,
    borderRadius: 15,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 14,
    marginBottom: 4,
    marginLeft: 8,
  },
  input: {
    width: '100%',
    padding: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 8,
    position: 'absolute',
    top: 42,
  },
});

export default InputWithLabel;
