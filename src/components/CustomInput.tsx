import React, { FC, useState } from 'react';
import { 
  TextInput,
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet 
} from 'react-native';
import Visibiliti from '../assets/visibility.svg';
import VisibilitiOff from '../assets/visibility-off.svg';


interface CustomInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  isError?: boolean;
  helperText?: string;
  height?: number;
  isPassword?: boolean;
  inputRightElement?: any;
  handlePressIn?: () => void;
}

export const CustomInput: FC<CustomInputProps> = ({
  value,
  onChangeText,
  placeholder,
  isError,
  helperText,
  handlePressIn,
  height = 72,
  isPassword,
  inputRightElement,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <View style={[styles.container, { height }]}>
      <TouchableOpacity
        onPressIn={handlePressIn}
        activeOpacity={1}
        style={styles.touchable}>
        <View
          style={[
            styles.inputContainer,
            isError && styles.inputError,
            isFocused && styles.inputFocused,
          ]}
        >
          <TextInput
            style={styles.input}
            maxLength={30}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={'#AEB3B6'}
            secureTextEntry={isPassword && !isPasswordVisible}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            editable={!handlePressIn}
            pointerEvents={handlePressIn ? 'none' : 'auto'}
            {...props}
          />
          {isPassword && (
            <TouchableOpacity
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={styles.iconButton}
            >
              {isPasswordVisible
                ? <Visibiliti width={24}/>
                : <VisibilitiOff width={24}/>}
            </TouchableOpacity>
          )}
          {inputRightElement && <View>
            {inputRightElement}
          </View>}
        </View>
      </TouchableOpacity>
      {isError && helperText && (
        <Text style={styles.helperText}>{helperText}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
  },
  touchable: {
    borderRadius: 16,
  },
  inputContainer: {
    height: 56,
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#000',
  },
  inputError: {
    backgroundColor: '#FDE3E9',
  },
  inputFocused: {
    borderWidth: 1,
    borderColor: '#2962FF',
  },
  iconButton: {
    padding: 8,
  },
  helperText: {
    color: '#E7004C',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 12,
  },
  rightElement: {
    position: 'absolute',
    right: 8,
    top:0,
    bottom: 0
  }
});
