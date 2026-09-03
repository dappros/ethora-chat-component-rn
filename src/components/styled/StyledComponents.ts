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
  background-color: #ffffff;
`;

export const ThreadContainer = styled.View`
  flex-direction: col;
  justify-content: space-between;
  flex: 1;
  width: 100%;
  background-color: #ffffff;
`;

export const ChatContainerHeader = styled.View`
  flex-direction: row;
  padding: 12px 16px;
  background-color: #ffffff;
  align-items: center;
  justify-content: space-between;
  /* Rounded bottom corners + a soft drop shadow instead of the hairline
   * rule, so the header reads as a card over the conversation. */
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  shadow-color: #101828;
  shadow-offset: 0px 4px;
  shadow-opacity: 0.06;
  shadow-radius: 12px;
  elevation: 4;
  z-index: 1000;
`;

export const CenterContainer = styled.View<{
  rightSpace?: boolean;
  leftSpace?: boolean;
}>`
  align-items: center;
  justify-content: center;
  /* flex:1 so the title fills the space BETWEEN the left (back/avatar) and
   * right (globe / call / menu) clusters and shrinks to make room for them.
   * The previous fixed 90% width overflowed the row (15% left + 90% center
   * + 25% right = 130%), pushing the right cluster — the translate globe,
   * call and room-menu icons — off-screen where it rendered but was clipped
   * by the device edge. min-width:0 lets the title ellipsize instead of
   * forcing the row wider. Mirrors the web header's flexbox layout. */
  flex: 1;
  min-width: 0;
  padding-right: ${({ rightSpace }) => (rightSpace ? '16' : '0')}px;
  padding-left: ${({ leftSpace }) => (leftSpace ? '16' : '0')}px;
`;

export const ChatContainerHeaderBoxInfo = styled.TouchableOpacity`
  flex: 1;
  flex-direction: row;
  align-items: center;
  /* Left-aligned: the avatar + chat-name row now hugs the left edge of
   * the header instead of centering itself within the available space.
   * Was: justify-content:center + max-width:90% which double-centered
   * with CenterContainer and pushed the title to the middle. */
  justify-content: flex-start;
  width: 100%;
  overflow: hidden;
  gap: 16px;
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

export const ChatContainerHeaderLabel = styled.Text<{
  fontSize?: number;
  fontWeight?: string;
}>`
  color: #141414;
  font-weight: ${({ fontWeight }) => fontWeight ?? 600};
  font-size: ${({ fontSize }) => fontSize ?? 16}px;
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
  background-color: ${(props) => (props.isUser ? '#e8eafd' : '#f3f6fc')};
  padding: 10px;
  margin: 10px 0;
  border-radius: 8px;
  max-width: 60%;
  flex-direction: row;
  align-self: ${(props) => (props.isUser ? 'flex-end' : 'flex-start')};
`;

export const MessageText = styled.Text`
  margin: 0;
  color: #141414;
`;

export const UserName = styled.Text`
  font-weight: bold;
  color: #141414;
`;

// Input Components
export const InputContainer = styled.View`
  background-color: #ffffff;
  flex-direction: row;
  gap: 5px;
  padding: 8px;
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
`;

export const MessageInput = styled.TextInput`
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background-color: #f5f7f9;
  color: #141414;
`;

export const IconButton = styled.TouchableOpacity`
  justify-content: center;
  align-items: center;
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
