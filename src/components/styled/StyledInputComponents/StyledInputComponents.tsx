/** @format */

import styled from "styled-components/native";

// Theme variables for reuse
const colors = {
  primary: "#141414",
  secondary: "#f5f7f9",
  border: "#ccc",
  white: "#fff",
  black: "#000",
};

export const InputContainer = styled.View<{ isText?: boolean }>`
  flex-direction: column;
  padding: 16px 0;
  background-color: ${colors.white};
  z-index: 100;
  width: 100%;
  bottom: 0;
  left: 0;
`;

export const MediaContainer = styled.View`
  flex-direction: row;
  gap: 8px;
  padding: 0 16px 8px;
`;

export const MediaImage = styled.Image`
  width: 70px;
  height: 70px;
  border-radius: 8px;
`;

export const MessageInputContainer = styled.View`
  flex-direction: row;
  align-items: center;
  width: 100%;
  max-height: 72px;
`;

export const MessageInput = styled.TextInput<{
  isFocused?: boolean;
  color?: string;
}>`
  flex-grow: 1;
  padding: 10px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${(props) =>
    props.isFocused ? props.color || "#0052CD" : "transparent"};
  color: #141414;
  background-color: #f5f7f9;
  max-height: 40px;
`;

export const HiddenFileInput = styled.View``;

export const Timer = styled.Text`
  justify-content: center;
  align-items: center;
  margin-left: 10px;
`;

export const TimerText = styled.Text`
  font-size: 18px;
  font-weight: bold;
  color: ${colors.black};
`;

export const WaveformContainer = styled.View`
  width: 100%;
  height: 40px;
  background-color: #f1f1f1;
`;

export const RecordContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

export const FilePreviewContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
`;

export const FilePreview = styled.View`
  justify-content: center;
  align-items: center;
  width: 100px;
  height: 100px;
  border-width: 1px;
  border-color: ${colors.border};
  border-radius: 8px;
  background-color: #f9f9f9;
  overflow: hidden;
`;

export const FileIcon = styled.Image`
  max-width: 80%;
  max-height: 80%;
`;

export const VideoPreview = styled.View`
  width: 100%;
  height: 100%;
`;

export const StyledInput = styled.TextInput`
  padding: 16px 12px;
  background-color: ${colors.secondary};
  font-size: 16px;
  border-radius: 16px;
`;

export const TextareaInput = styled.TextInput`
  padding: 16px 12px;
  background-color: ${colors.secondary};
  font-size: 16px;
  color: ${colors.black};
  border-radius: 16px;
`;
