import styled from 'styled-components/native';

export const Container = styled.View`
  margin: 0;
  cursor: pointer;
  /* Hug the media to the start instead of centering it inside the
     bubble — centering made media bubbles look adrift vs the
     left/right-aligned text bubbles. The bubble's own alignSelf (set
     in Message.tsx) handles sender-side alignment. */
  align-items: flex-start;
  align-self: stretch;
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

export const UnsupportedContainer = styled.TouchableOpacity`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  border-radius: 8px;
  padding: 10px;
  margin: 5px 0;
  cursor: pointer;
  gap: 8px;
`;

export const BackgroundFile = styled.View`
  background-color: #f9f9f9;
  border-radius: 8px;
`;

export const FileInformation = styled.View`
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

export const FileName = styled.Text`
  font-size: 14px;
  font-weight: 500;
  flex-grow: 1;
  color: #fff;
  overflow: hidden;
`;

export const FileSizeContainer = styled.View`
  align-items: flex-start;
  flex-direction: row;
  background-color: #f2e6f6;
  padding: 2px 8px;
  border-radius: 10px;
`;

export const FileSize = styled.Text`
  color: #53575a;
  overflow: hidden;
  text-align: left;
  font-weight: 500;
`;
