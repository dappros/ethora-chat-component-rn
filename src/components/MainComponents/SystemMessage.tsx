import React from 'react';
import { CustomSystemMessage } from '../styled/StyledComponents';
import styled from 'styled-components/native';

interface SystemMessageProps {
  messageText?: string;
  colors?: { primary?: string; secondary?: string };
}

export const CustomSystemMessageText = styled.Text<{
  primary?: string;
  secondary?: string;
}>`
  margin: 0;
  color: ${(props) => props.primary || '#0052cd'};
  border-radius: 12px;
  padding: 6px 12px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  text-align: center;
  max-width: 85%;
  background-color: ${(props) => props.secondary || '#e7edf9'};
`;

const SystemMessage: React.FC<SystemMessageProps> = ({
  messageText,
  colors,
}) => {
  return (
    <CustomSystemMessage>
      <CustomSystemMessageText {...colors}>
        {messageText}
      </CustomSystemMessageText>
    </CustomSystemMessage>
  );
};

export default SystemMessage;
