import React, { forwardRef } from 'react';

import styled from 'styled-components/native';
import { MessageProps } from '../../types/types';
import { View } from 'react-native';

export const MessageContainer = styled.View<{ isUser: boolean }>`
  display: flex;
  flex-direction: ${(props) => (!props.isUser ? 'row' : 'row-reverse')};
  align-items: center;
  margin: 10px 0;
  width: 100%;
`;

export const MessageBubble = styled.View<{ isUser: boolean }>`
  background-color: ${({ isUser, theme }) =>
    !isUser ? theme.surfaceSecondary : theme.primary};
  color: ${({ isUser, theme }) => (!isUser ? theme.text : theme.textOnPrimary)};
  border-radius: 12px;
  padding: 10px;
  max-width: 60%;
`;

export const MessageText = styled.View`
  margin: 0;
  flex-wrap: wrap;
`;

export const UserName = styled.Text<{ isUser: boolean; color?: string }>`
  font-weight: bold;
  color: ${({ color, isUser, theme }) =>
    color ? color : isUser ? theme.primary : theme.text};
  margin-right: 8px;
`;

export const MessageTimestamp = styled.Text`
  font-size: 13px;
  color: ${({ theme }) => theme.textMuted};
  margin-left: 8px;
`;

export const MessagePhoto = styled.Image`
  max-width: 100%;
  border-radius: 8px;
  margin-top: 8px;
`;

export const MessagePhotoContainer = styled.Text`
  max-width: 100px;
  margin: 0;
`;

export const SystemMessage = styled.Text`
  background-color: ${({ theme }) => theme.systemMessageBackground};
  color: ${({ theme }) => theme.textSecondary};
  text-align: center;
  padding: 8px;
  border-radius: 8px;
  margin: 10px 0;
  max-width: 60%;
`;

export const SystemMessageText = styled.Text`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.text};
`;

const CustomMessageExample = forwardRef<View, MessageProps>(
  ({ message, isUser }, ref) => {
    return (
      <View
        ref={ref}
        style={[
          {
            flexDirection: isUser ? 'row-reverse' : 'row',
            alignItems: 'center',
            marginVertical: 10,
            width: '100%',
          },
        ]}
      >
        <MessageBubble isUser={isUser}>
          <UserName isUser={isUser}>{message.user.name}</UserName>
          <MessageText>{message.body}</MessageText>
          <MessageTimestamp>{message.timestamp}</MessageTimestamp>
        </MessageBubble>
      </View>
    );
  }
);

export default CustomMessageExample;
