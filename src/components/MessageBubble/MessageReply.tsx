import { FC } from "react";
import { IMessage } from "../../types/types";
import { styled } from "styled-components/native";
import { Text } from "react-native";

export const StyledMessageReply = styled.TouchableOpacity<{ isUser: boolean }>`
  background-color: ${(props) => (props.isUser ? "#ffffff" : "#E7EDF9")};
  padding: 8px 16px;
  border-radius: 4px;
  border-style: solid;
  border-left-width: ${(props) => (props.isUser ? 4 : 0)}px;
  border-left-color: ${(props) => (props.isUser ? "#0052CD" : "transparent")};
  border-right-width: ${(props) => (!props.isUser ? 4 : 0)}px;
  border-right-color: ${(props) => (!props.isUser ? "#0052CD" : "transparent")};
`;

const StyledText = styled.Text`
  font-size: 14px;
  overflow: hidden;
`;

interface MessageReplyProps {
  isUser: boolean;
  text: string;
  handleReplyMessage: () => void;
}

export const MessageReply: FC<MessageReplyProps> = ({
  isUser,
  text,
  handleReplyMessage,
}) => {
  return (
    <StyledMessageReply onPress={handleReplyMessage} isUser={isUser}>
      <StyledText>{text}</StyledText>
    </StyledMessageReply>
  );
};
