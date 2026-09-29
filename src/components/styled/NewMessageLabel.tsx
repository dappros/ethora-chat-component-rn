import React from 'react';
import styled from 'styled-components/native';
import { Line } from './StyledComponents';
import { useT } from '../../i18n/useT';

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
  background-color: #3f3f3f;
  height: 24px;
  white-space: nowrap;
  margin: 10px 0px;
`;

export const StyledLabelText = styled.Text`
  color: #ffffff;
  font-size: 12px;
  line-height: 14px;
  font-weight: 500;
`;

// `color` is kept for CustomNewMessageLabel API parity, but the built-in
// label always renders WHITE text — it sits on a dark (#3f3f3f) pill, where
// the previous primary/blue text was unreadable.
interface NewMessageLabelProps {
  color?: string;
}

const NewMessageLabel: React.FC<NewMessageLabelProps> = () => {
  const t = useT();
  return (
    <Container>
      <Line />
      <StyledLabel>
        <StyledLabelText>{t('message.newMessages')}</StyledLabelText>
      </StyledLabel>
      <Line />
    </Container>
  );
};

export default NewMessageLabel;
