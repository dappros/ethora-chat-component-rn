import styled from 'styled-components/native';

export const Container = styled.View`
  margin: 0;
  cursor: pointer;
  /* The media has an explicit (scaled) width set inline. Its horizontal
     position inside the bubble is driven by the bubble's align-items
     (set per-sender in Message.tsx): own messages push the media to the
     right edge, others to the left — so the media stays flush with the
     text bubbles on the same side instead of leaving a gap. */
  align-items: flex-start;
  align-self: auto;
  overflow: hidden;
  border-radius: 10px;
`;

export const FullScreenImage = styled.Image`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

export const ModalContent = styled.View`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 10px;
`;

export const ButtonContainer = styled.View`
  display: flex;
  position: absolute;
  top: 8px;
  right: 8px;
  gap: 4px;
`;

export const IconButton = styled.TouchableOpacity`
  border: none;
  cursor: pointer;
  color: gray;
  font-size: 36px;
  display: flex;
  align-items: center;
  gap: 5px;
  pointer-events: auto;
`;

export const UnsupportedContainer = styled.TouchableOpacity<{ isUser?: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  border-radius: 12px;
  padding: 8px;
  margin: 8px;
  cursor: pointer;
  gap: 8px;
  background-color: ${({ isUser }) => (isUser ? '#EDF5FF' : '#F7F9FC')};
  border-width: 1px;
  border-color: ${({ isUser }) => (isUser ? '#D7E6FF' : '#E7ECF3')};
  min-width: 196px;
  max-width: 260px;
`;

export const BackgroundFile = styled.View`
  width: 54px;
  height: 54px;
  align-items: center;
  justify-content: center;
  background-color: #F3EAFB;
  border-radius: 10px;
`;

export const FileInformation = styled.View`
  flex: 1;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
`;

export const FileName = styled.Text<{
  isUser: boolean;
  colorIsUser: string | undefined;
  colorUsers: string | undefined;
}>`
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 1;
  color: ${({ isUser, colorIsUser }) =>
    isUser ? colorIsUser || '#1D4ED8' : '#1F2937'};
`;

export const FileSizeContainer = styled.View`
  align-items: flex-start;
  flex-direction: row;
  background-color: #FFFFFF;
  padding: 3px 8px;
  border-radius: 999px;
`;

export const FileSize = styled.Text`
  color: #667085;
  overflow: hidden;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
`;
