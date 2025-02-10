import { Picker } from "emoji-mart";
import styled from "styled-components/native";

export const ContainerInteractions = styled.View`
  position: absolute;
  z-index: 1000;
`;

export const ReactionContainer = styled.View`
  max-width: 245px;
  display: flex;
  margin-bottom: 16px;
  gap: 8px;
  padding: 8px;
  justify-content: space-around;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

export const ReactionBadge = styled.Text`
  font-size: 22px;
  cursor: pointer;
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.2);
  }
`;

export const ArrowButton = styled.View<{ isRotated: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.3s ease;

  transform: ${({ isRotated }) =>
    isRotated ? 'rotate(180deg)' : 'rotate(0deg)'};
`;

export const StyledPicker = styled(Picker)`
  .emoji-mart-preview {
    display: none;
  }
`;

export const ContextMenu = styled.View`
  position: absolute;
  z-index: 1000;
  background-color: white;
  border-radius: 8px;
  elevation: 4;
  shadow-color: #121219;
  shadow-offset: 0px 4px;
  shadow-opacity: 0.1;
  shadow-radius: 6px;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
`;

export const MenuItem = styled.Pressable`
  padding: 8px 8px;
  min-width: 150px;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

export const Overlay = styled.Pressable`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  background: transparent;
`;

export const Delimeter = styled.View`
  border: 1px solid #0052cd0d;
`;

// export const Delimeter = styled.View`
//   border: 1px solid var(--colors-background-bg-prymary-5, #0052cd0d);
// `;
