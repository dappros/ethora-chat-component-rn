import React from 'react';
import {View, Text, TextInput, StyleSheet} from 'react-native';

interface StyledInputProps {
  label?: string;
  color?: string;
  helperText?: string;
  error?: boolean;
  [key: string]: any;
}

const InputWrapper = ({children}: {children: React.ReactNode}) => {
  return <View style={styles.inputWrapper}>{children}</View>;
};

const Label = ({children}: {children: React.ReactNode}) => (
  <Text style={styles.label}>{children}</Text>
);

const StyledInput = ({
  color,
  error,
  ...props
}: {color?: string; error?: boolean} & React.ComponentProps<
  typeof TextInput
>) => (
  <TextInput
    style={[
      styles.input,
      {
        borderColor: error ? 'red' : color || '#0052CD',
        backgroundColor: '#f5f7f9',
      },
    ]}
    {...props}
  />
);

const HelperText = ({
  children,
  error,
}: {
  children: React.ReactNode;
  error?: boolean;
}) => (
  <Text style={[styles.helperText, {color: error ? 'red' : '#8c8c8c'}]}>
    {children}
  </Text>
);

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
  },
  label: {
    fontSize: 14,
    color: '#8c8c8c',
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
