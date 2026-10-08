import React, { useState, useEffect, useRef } from 'react';
import styled, { css } from 'styled-components/native';
import {
  TextInput,
  View,
  TouchableOpacity,
  TextInputProps,
  Text,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';

const shouldForwardProp = (prop: string) =>
  prop !== 'animated' && prop !== 'expanded' && prop !== 'direction';

const SearchInputWrapper = styled.View.withConfig({ shouldForwardProp })<{
  animated?: boolean;
  direction?: string;
  expanded?: boolean;
}>`
  position: relative;
  flex-direction: row;
  align-items: center;
  background-color: ${({ theme }) => theme.surface};
  border-radius: 16px;
  height: 44px;
  padding: 0 12px;
  margin: 0 0 12px 0;
  flex: 1;
  ${({ animated, expanded }) =>
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
  padding: 0;
  margin-right: 8px;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.textMuted};
`;

const StyledInput = styled(TextInput)<{
  animated?: boolean;
  expanded?: boolean;
}>`
  background-color: transparent;
  border: none;
  flex: 1;
  font-size: 16px;
  color: ${({ theme }) => theme.text};
  opacity: ${({ animated, expanded }) => (animated && !expanded ? 0 : 1)};
  display: ${({ animated, expanded }) =>
    animated && !expanded ? 'none' : 'flex'};
  ${({ animated }) =>
    animated &&
    css`
      transition: opacity 0.7s ease-in-out;
    `}
`;

interface SearchInputProps extends TextInputProps {
  icon?: React.ReactNode;
  animated?: boolean;
  direction?: 'left' | 'right';
  placeholder?: string;
  value: string;
}

const clearStyles = StyleSheet.create({
  button: {
    width: 28,
    height: 28,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 22, lineHeight: 24 },
});

const SearchInput: React.FC<SearchInputProps> = ({
  icon,
  animated = false,
  direction = 'left',
  placeholder,
  ...props
}) => {
  const theme = useTheme();
  const t = useT();
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
      onTouchStart={handleFocus}
    >
      {icon && (
        <SearchIcon
          animated={animated}
          expanded={isExpanded}
          onPress={() => inputRef.current?.focus()}
        >
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
        placeholderTextColor={theme.textMuted}
        keyboardAppearance={theme.dark ? 'dark' : 'light'}
        {...props}
      />
      {props.value ? (
        <TouchableOpacity
          testID="search-clear"
          accessibilityRole="button"
          accessibilityLabel={t('search.clear')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => {
            props.onChangeText?.('');
            setIsTyping(false);
            inputRef.current?.focus();
          }}
          style={clearStyles.button}
        >
          <Text style={[clearStyles.glyph, { color: theme.textMuted }]}>
            {'\u00D7'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </SearchInputWrapper>
  );
};

export { SearchInput };
