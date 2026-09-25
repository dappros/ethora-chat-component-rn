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
  color: ${({theme}) => theme.text};
`;

export const OrDelimiter = styled.Text`
  font-size: 14px;
  color: ${({theme}) => theme.textSecondary};
`;

export const CustomButton = styled.TouchableOpacity`
  width: 100%;
  background-color: ${({theme}) => theme.primary};
  padding: 10px;
  border-radius: 4px;
  align-items: center;
`;

export const ButtonText = styled.Text`
  color: ${({theme}) => theme.textOnPrimary};
  font-size: 16px;
`;
