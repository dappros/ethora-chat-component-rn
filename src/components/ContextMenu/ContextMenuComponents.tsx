import styled from "styled-components/native";

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
