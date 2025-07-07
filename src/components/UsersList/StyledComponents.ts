import styled from "styled-components/native";
import CheckBox from '@react-native-community/checkbox';

export const ScrollableContainer = styled.View`
  max-height: 100px;
  overflow-y: auto;
  width: 80%;
  padding: 8px;
  max-width: 80%;
`;

export const UserItem = styled.TouchableHighlight`
  display: flex;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid #f0f0f0;
  gap: 8px;
`;


export const Checkbox = styled(CheckBox)`
  width: 16px;
  height: 16px;
  tint-color: #0052cd;
`;

export const Label = styled.Text`
  font-size: 16px;
  color: #333;
`;
