import React, {useState, useEffect, useRef} from 'react';
import styled, {css} from 'styled-components/native';
import {TextInput, View, TouchableOpacity, TextInputProps} from 'react-native';

interface SearchInputProps extends TextInputProps {
  icon?: React.ReactNode;
  animated?: boolean;
  direction?: 'left' | 'right';
  placeholder?: string;
  value: string;
  background?: string;
}

const SearchInputWrapper = styled.View<{
  animated?: boolean;
  direction?: string;
  expanded?: boolean;
  background?: string;
}>`
  position: relative;
  flex-direction: row;
  align-items: center;
  background-color: ${({background}) => background || '#FFFFFF' };
  border-radius: 16px;
  height: 48px;
  padding: 0 16px;
  margin: 0 6px 16px 6px;
  flex: 1;
  ${({animated, expanded}) =>
    animated &&
    css`
      justify-content: ${expanded ? 'flex-start' : 'center'};
      transition: width 0.7s ease-in-out;
    `};
`;

const SearchIcon = styled(TouchableOpacity)<{
  animated?: boolean;
  expanded?: boolean;
}>`
  padding: 3.5px;
  color: #999;
`;

const StyledInput = styled(TextInput)<{
  animated?: boolean;
  expanded?: boolean;
}>`
  background-color: transparent;
  border: none;
  flex: 1;
  font-size: 16px;
  color: #000;
  opacity: ${({animated, expanded}) => (animated && !expanded ? 0 : 1)};
  display: ${({animated, expanded}) =>
    animated && !expanded ? 'none' : 'flex'};
  ${({animated}) =>
    animated &&
    css`
      transition: opacity 0.7s ease-in-out;
    `}
`;

const SearchInput: React.FC<SearchInputProps> = ({
  icon,
  animated = false,
  direction = 'left',
  placeholder,
  background,
  ...props
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  const handleFocus = () => {
    setIsExpanded(true);
  };

  const handleBlur = () => {
    if (!isTyping) {
      setIsExpanded(false);
    }
  };

  const handleInput = (text: string) => {
    setIsTyping(!!text);
  };

  useEffect(() => {
    if (isExpanded && animated) {
      const timeout = setTimeout(() => {
        inputRef.current?.focus();
      }, 250);

      return () => clearTimeout(timeout);
    }
  }, [isExpanded, animated]);

  return (
    <SearchInputWrapper
      animated={animated}
      direction={direction}
      expanded={isExpanded}
      background={background}
      onTouchStart={handleFocus}>
      {icon && (
        <SearchIcon
          animated={animated}
          expanded={isExpanded}
          onPress={() => inputRef.current?.focus()}>
          {icon}
        </SearchIcon>
      )}
      <StyledInput
        ref={inputRef}
        onBlur={handleBlur}
        animated={animated}
        expanded={isExpanded}
        onChangeText={handleInput}
        placeholder={placeholder}
        placeholderTextColor="#999"
        {...props}
      />
    </SearchInputWrapper>
  );
};

export {SearchInput};
