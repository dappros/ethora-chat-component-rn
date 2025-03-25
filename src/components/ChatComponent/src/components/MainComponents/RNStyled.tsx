import {View, Text, Button} from 'react-native';
import styled from 'styled-components/native';

export const Container = styled.View`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  padding: 20px;
  gap: 8px;
`;

export const Message = styled.Text`
  font-size: 16px;
  color: #333;
`;

export const OrDelimiter = styled.Text`
  font-size: 14px;
  color: #666;
`;

export const CustomButton = styled.TouchableOpacity`
  width: 100%;
  background-color: #007bff;
  padding: 10px;
  border-radius: 4px;
  align-items: center;
`;

export const ButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
`;
