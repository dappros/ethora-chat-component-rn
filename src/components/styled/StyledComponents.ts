/** @format */

import styled from 'styled-components/native';
import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// General Containers
export const ChatContainer = styled.View`
  position: relative;
  flex-direction: column;
  flex: 1;
  width: 100%;
  background-color: #1a1a1a;
`;

export const ThreadContainer = styled.View`
  flex-direction: col;
  justify-content: space-between;
  flex: 1;
  width: 100%;
  background-color: #1a1a1a;
`;

export const ChatContainerHeader = styled.View`
  flex-direction: row;
  padding: 2px 8px;
  padding-top: 62px;
  max-height: 24px;
  min-height: 24px;
  background-color: #2a2a2a;
  align-items: center;
  justify-content: space-between;
  border-bottom-width: 1px;
  border-bottom-color: #3a3a3a;
  border-style: solid;
  z-index: 1000;
`;

export const CenterContainer = styled.View<{
  rightSpace?: boolean;
  leftSpace?: boolean;
}>`
  align-items: center;
  justify-content: center;
  width: ${({ rightSpace, leftSpace }) =>
    rightSpace && !leftSpace
      ? '100%'
      : rightSpace || !leftSpace
        ? '90%'
        : '70%'};
  padding-right: ${({ rightSpace }) => (rightSpace ? '16' : '0')}px;
  padding-left: ${({ leftSpace }) => (leftSpace ? '16' : '0')}px;
`;

export const ChatContainerHeaderBoxInfo = styled.TouchableOpacity`
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  max-width: 90%;
  gap: 16px;
  flex: 1;
`;

export const ChatContainerHeaderInfo = styled.View`
  flex: 1;
  gap: 2px;
  align-items: left;
  justify-content: center;
  overflow: hidden;
  text-align: left;
  flex-direction: column;
  gap: 2px;
`;

export const ChatContainerHeaderLabel = styled.Text`
  color: #ffffff;
  font-weight: 600;
  font-size: 16px;
  text-align: left;
  overflow: hidden;
  max-width: 100%;
`;

// Messages
export const NonRoomChat = styled.View`
  flex: 1;
  width: 100%;
  align-items: center;
  justify-content: center;
  background-color: #fff;
  flex-direction: column;
  gap: 16px;
`;

export const MessagesScroll = styled.ScrollView`
  flex: 1;
  background-color: #f3f6fc;
  padding: 0px 16px;
`;

export const MessagesList = styled.View`
  width: 100%;
  min-height: 20px;
  position: relative;
`;

export const MessageTimestamp = styled.Text`
  font-size: 12px;
  color: #999;
  margin-bottom: 5px;
`;

export const Message = styled.View<{ isUser: boolean }>`
  background-color: ${(props) => (props.isUser ? '#3a3a3a' : '#2a2a2a')};
  padding: 10px;
  margin: 10px 0;
  border-radius: 8px;
  max-width: 60%;
  flex-direction: row;
  align-self: ${(props) => (props.isUser ? 'flex-end' : 'flex-start')};
`;

export const MessageText = styled.Text`
  margin: 0;
  color: #ffffff;
`;

export const UserName = styled.Text`
  font-weight: bold;
  color: #ffffff;
`;

// Input Components
export const InputContainer = styled.View`
  background-color: #2a2a2a;
  flex-direction: row;
  gap: 5px;
  padding: 8px;
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
`;

export const MessageInput = styled.TextInput`
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #3a3a3a;
  background-color: #3a3a3a;
  color: #ffffff;
`;

export const SendButton = styled.TouchableOpacity`
  padding: 10px 20px;
  border-radius: 8px;
  background-color: #007bff;
  box-shadow: 1px -1px 10px rgba(0, 0, 0, 0.25);
  justify-content: center;
  align-items: center;
`;

export const SendButtonText = styled.Text`
  color: white;
`;

// Avatar and Utility Components
export const AvatarCircle = styled.TouchableOpacity<{
  bgColor?: string;
  size?: number;
  isClickable: boolean;
}>`
  width: ${({ size }) => `${size}px` || '64px'};
  height: ${({ size }) => `${size}px` || '64px'};
  border-radius: 60px;
  background-color: ${({ bgColor }) => bgColor};
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

export const AvatarImage = styled.Image<{ size?: number }>`
  width: 100%;
  height: 100%;
  border-radius: 50px;
  object-fit: cover;
`;

export const RemoveButton = styled.TouchableOpacity`
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 50px;
  justify-content: center;
  align-items: center;
`;

export const RemoveButtonText = styled.Text`
  color: #fff;
  font-size: 12px;
  font-weight: bold;
`;

export const InitialsText = styled.Text<{ size?: number; color?: string }>`
  font-size: ${({ size }) => (size && size >= 64 ? '24px' : '18px')};
  color: ${({ color }) => (color ? color : '#fff')};
  font-weight: bold;
`;

export const Overlay = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
`;

export const CustomMessageText = styled.Text<{
  isUser?: boolean;
  color?: string;
  colorUser: string;
}>`
  margin: 0px;
  color: ${({ color, isUser, colorUser }) =>
    isUser ? colorUser || '#000' : color || '#000'};
`;

export const FileInput = styled.TextInput`
  display: none;
`;

export const StyledLoaderWrapper = styled.View`
  width: ${width}px;
  height: ${height}px;
  justify-content: center;
  align-items: center;
`;

export const OrDelimiter = styled.Text`
  width: 100%;
  align-items: center;
  justify-content: center;
  position: relative;
`;

export const OrDelimiterText = styled.Text`
  font-size: 14px;
  color: #999;
`;

export const Line = styled.View`
  width: 100%;
  height: 1px;
  background-color: #0052cd0d;
`;

export const AlsoCheckbox = styled.View<{ accentColor: string }>`
  width: 16px;
  height: 16px;
  background-color: ${(props) => props.accentColor};
  border-radius: 4px;
`;

export const AlsoContainer = styled.TouchableOpacity`
  align-items: center;
  flex-direction: row;
  gap: 8px;
  background-color: #0052cd0d;
  font-size: 14px;
  padding: 10px 28px;
  text-align: start;
`;

export const Wrapper = styled.View<{
  bgColor?: string;
  size?: number;
  isClickable: boolean;
}>`
  width: ${({ size }) => `${size}px` || '64px'};
  height: ${({ size }) => `${size}px` || '64px'};
  margin: 8px 0 8px 8px;
  border-radius: 60px;
  background-color: ${({ bgColor }) => bgColor};
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
`;

export const CustomSystemMessage = styled.View`
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  background-color: transparent;
  gap: 16px;
  margin: 8px;
`;

export const MessageFooter = styled.View<{ isUser: boolean }>`
  flex-direction: row;
  justify-content: flex-start;
  position: absolute;
  gap: 6px;
  bottom: -25px;
  left: ${(props) => (!props.isUser ? '10px' : 'auto')};
  right: ${(props) => (props.isUser ? '10px' : 'auto')};

  @media (max-width: 675px) {
    font-size: 12px;
    bottom: -24px;
  }
`;
