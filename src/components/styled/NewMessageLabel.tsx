import React from "react";
import styled from "styled-components/native";
import { Line } from "./StyledComponents";

const Container = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 100%;
  background-color: transparent;
  gap: 16px;
`;

export const StyledLabel = styled.View`
  margin: 0;
  border-radius: 118px;
  padding: 5px 8px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: #e7edf9;
  height: 24px;
  white-space: nowrap;
  margin: 10px 0px;
`;

export const StyledLabelText = styled.Text<{ color?: string }>`
  color: ${(props) => (props?.color ? props?.color : "#0052CD")};
  font-size: 12px;
  line-height: 14px;
  font-weight: 400;
`;

interface NewMessageLabelProps {
  color?: string;
}

const NewMessageLabel: React.FC<NewMessageLabelProps> = ({ color }) => {
  return (
    <Container>
      <Line />
      <StyledLabel>
        <StyledLabelText color={color}>New messages</StyledLabelText>
      </StyledLabel>
      <Line />
    </Container>
  );
};

export default NewMessageLabel;
