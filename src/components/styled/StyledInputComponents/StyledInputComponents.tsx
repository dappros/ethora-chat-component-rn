import styled from "styled-components/native";

export const InputContainer = styled.View`
  flex-direction: column;
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
  padding: 16px;
  background-color: #fff;
  z-index: 1;
  shadow-color: #121219;
  shadow-offset: { width: 0, height: 4 };
  shadow-opacity: 0.08;
  shadow-radius: 12px;
  elevation: 4;
`;

export const MessageInputContainer = styled.View`
  flex-direction: row;
  align-items: center;
  width: 100%;
  max-height: 72px;
  gap: 16px;
`;

export const MessageInput = styled.TextInput<{ color?: string }>`
  flex-grow: 1;
  padding: 10px;
  border-radius: 12px;
  border-width: 0;
  color: #141414;
  background-color: #f5f7f9;
  max-height: 40px;
  ${({ color }) =>
    color &&
    `
    border-width: 1px;
    border-color: ${color};
  `};
`;

export const HiddenFileInput = styled.View`
  display: none;
`;

export const Timer = styled.View`
  justify-content: center;
  align-items: center;
  margin-left: 10px;
`;

export const TimerText = styled.Text`
  font-size: 18px;
  font-weight: bold;
  color: #000;
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
  height: 40px;
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
  border-color: #ccc;
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

export const StyledInput = styled.TextInput<{ color?: string }>`
  padding: 16px 12px;
  background-color: #f5f7f9;
  border: none;
  outline: none;
  font-size: 16px;
  color: ${(props) => props.color || "#000"};
  border-radius: 16px;

  &::placeholder {
    opacity: 1;
  }
`;

export const TextareaInput = styled.TextInput`
  padding: 16px 12px;
  background-color: #f5f7f9;
  font-size: 16px;
  color: #000;
  border-radius: 16px;
  text-align-vertical: top;
`;
