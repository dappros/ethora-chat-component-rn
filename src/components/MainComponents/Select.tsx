import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components/native';
import {
  Animated,
  TextInput,
  TouchableOpacity,
  FlatList,
  Keyboard,
} from 'react-native';
import { Iso639_1Codes } from '../../types/types';
import { useTheme } from '../../hooks/useTheme';

const SelectWrapper = styled.View`
  position: relative;
  width: 100%;
`;

const SelectBox = styled.TouchableOpacity<{
  isOpen: boolean;
  borderColor?: string;
}>`
  border: ${({ borderColor, theme }) =>
    `1px solid ${borderColor || theme.border}`};
  padding: 10px;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  background-color: ${({ theme }) => theme.surface};
  border-radius: 5px;
  box-shadow: ${({ isOpen }) =>
    isOpen ? '0px 4px 8px rgba(0, 0, 0, 0.1)' : 'none'};
`;

// Light keeps its original #aaa; dark uses the palette's muted text.
const Placeholder = styled.Text`
  color: ${({ theme }) => (theme.dark ? theme.textMuted : '#aaa')};
`;

const Icon = styled(Animated.Text)`
  margin-left: 10px;
`;

const Dropdown = styled.View`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background-color: ${({ theme }) => theme.surface};
  max-height: 200px;
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 5px;
  z-index: 100;
`;

const SearchBox = styled.TextInput`
  width: 100%;
  padding: 10px;
  border-bottom-width: 1px;
  border-color: ${({ theme }) => theme.border};
  color: ${({ theme }) => theme.text};
  box-sizing: border-box;
`;

const DropdownItem = styled.TouchableOpacity`
  padding: 10px;
`;

const DropdownItemText = styled.Text`
  color: ${({ theme }) => theme.text};
`;

interface SelectProps {
  options: { name: string; id: Iso639_1Codes }[];
  placeholder: string;
  onSelect: (selected: { name: string; id: Iso639_1Codes }) => void;
  accentColor?: string;
  selectedValue: { name: string; id: string } | null;
}

const Select: React.FC<SelectProps> = ({
  options,
  placeholder,
  onSelect,
  accentColor,
  selectedValue = null,
}) => {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<{ name: string; id: string } | null>(
    selectedValue
  );
  const [searchTerm, setSearchTerm] = useState('');
  const rotationAnim = useRef(new Animated.Value(0)).current;

  const toggleDropdown = () => {
    setIsOpen((prev) => !prev);
    Animated.timing(rotationAnim, {
      toValue: isOpen ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const handleSelect = (option: { name: string; id: Iso639_1Codes }) => {
    setSelected(option);
    onSelect(option);
    setIsOpen(false);
    setSearchTerm('');
    Keyboard.dismiss();
  };

  const filteredOptions = options.filter((option) =>
    option.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const rotateInterpolation = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <SelectWrapper>
      <SelectBox
        isOpen={isOpen}
        onPress={toggleDropdown}
        borderColor={accentColor}
      >
        {selected ? (
          <Placeholder>{selected.name}</Placeholder>
        ) : (
          <Placeholder>{placeholder}</Placeholder>
        )}
        <Icon
          style={{
            transform: [{ rotate: rotateInterpolation }],
            color: accentColor,
          }}
        >
          ▼
        </Icon>
      </SelectBox>
      {isOpen && (
        <Dropdown>
          <SearchBox
            placeholder="Search..."
            placeholderTextColor={theme.textMuted}
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          <FlatList
            data={filteredOptions}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <DropdownItem onPress={() => handleSelect(item)}>
                <DropdownItemText>{item.name}</DropdownItemText>
              </DropdownItem>
            )}
            ListEmptyComponent={
              <DropdownItem>
                <DropdownItemText>No options found</DropdownItemText>
              </DropdownItem>
            }
          />
        </Dropdown>
      )}
    </SelectWrapper>
  );
};

export default Select;
