import { FC } from 'react';
import { IMessage } from '../../types/types';
import { styled } from 'styled-components/native';
import { Text } from 'react-native';

export const StyledMessageReply = styled.TouchableOpacity<{
  isUser: boolean;
  configColor: string;
}>`
  background-color: ${(props) => (props.isUser ? '#ffffff' : '#E7EDF9')};
  padding: 8px 16px;
  margin-bottom: 8px;
  border-radius: 4px;
  border-style: solid;
  border-start-width: ${(props) => (props.isUser ? 4 : 0)}px;
  border-start-color: ${(props) =>
    props.isUser ? props.configColor : 'transparent'};
  border-end-width: ${(props) => (!props.isUser ? 4 : 0)}px;
  border-end-color: ${(props) =>
    !props.isUser ? props.configColor : 'transparent'};
`;

const StyledText = styled.Text`
  font-size: 14px;
  overflow: hidden;
`;

interface MessageReplyProps {
  isUser: boolean;
  text: string;
  color?: string;
  handleReplyMessage: () => void;
}

export const MessageReply: FC<MessageReplyProps> = ({
  isUser,
  text,
  color = '#0052CD',
  handleReplyMessage,
}) => {
  return (
    <StyledMessageReply
      onPress={handleReplyMessage}
      isUser={isUser}
      configColor={color}
    >
      <StyledText>{text}</StyledText>
    </StyledMessageReply>
  );
};
