/** @format */

import styled from "styled-components/native";

// General Containers
export const ChatContainer = styled.ScrollView`
  flex: 1;
  width: 100%;
  background-color: #f3f6fc;
`;

export const ChatContainerHeader = styled.View`
  flex-direction: row;
  border-bottom-left-radius: 15px;
  border-bottom-right-radius: 15px;
  padding: 16px;
  background-color: #fff;
  justify-content: space-between;
`;

export const ChatContainerHeaderBoxInfo = styled.TouchableOpacity`
  flex-direction: row;
  gap: 8px;
`;

export const ChatContainerHeaderInfo = styled.View`
  text-align: left;
  flex-direction: column;
  gap: 2px;
`;

export const ChatContainerHeaderLabel = styled.Text`
  color: #141414;
  font-weight: 600;
  font-size: 16px;
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
  min-height: 1.25em;
  position: relative;
`;

export const MessageTimestamp = styled.Text`
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
`;

export const Message = styled.View<{ isUser: boolean }>`
  background-color: ${(props) => (props.isUser ? "#dcf8c6" : "#f1f1f1")};
  padding: 10px;
  margin: 10px 0;
  border-radius: 8px;
  max-width: 60%;
  flex-direction: row;
  align-self: ${(props) => (props.isUser ? "flex-end" : "flex-start")};
`;

export const MessageText = styled.Text`
  margin: 0;
`;

export const UserName = styled.Text`
  font-weight: bold;
`;

// Input Components
export const InputContainer = styled.View`
  background-color: #fff;
  flex-direction: row;
  gap: 5px;
  padding: 8px;
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
`;

export const MessageInput = styled.TextInput`
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #ccc;
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
export const AvatarCircle = styled.View<{ bgColor: string; size?: number }>`
  width: ${({ size }) => size || 64}px;
  height: ${({ size }) => size || 64}px;
  border-radius: 50%;
  background-color: ${({ bgColor }) => bgColor};
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const AvatarImage = styled.Image`
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
`;

export const RemoveButton = styled.TouchableOpacity`
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  justify-content: center;
  align-items: center;
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

export const FileInput = styled.TextInput`
  display: none;
`;

export const StyledLoaderWrapper = styled.View`
  flex: 1;
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
  background-color: #ccc;
`;

export const AlsoCheckbox = styled.TouchableOpacity<{ accentColor: string }>`
  width: 16px;
  height: 16px;
  background-color: ${(props) => props.accentColor};
  border-radius: 4px;
`;

export const Wrapper = styled.View<{ bgColor: string; size?: number }>`
  width: ${({ size }) => size || 64}px;
  height: ${({ size }) => size || 64}px;
  border-radius: 50%;
  background-color: ${({ bgColor }) => bgColor};
  display: flex;
  align-items: center;
  justify-content: center;
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
