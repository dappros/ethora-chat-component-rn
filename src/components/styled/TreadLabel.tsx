import React from 'react';
import styled from 'styled-components/native';
import { useTheme } from '../../hooks/useTheme';
import { Line } from './StyledComponents';

interface DateLabelProps {
  reply: number;
  colors?: { primary?: string; secondary?: string };
}

const Container = styled.View`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  background-color: transparent;
  gap: 16px;
`;

export const StyledDateLabel = styled.Text<{
  primary?: string;
  secondary?: string;
}>`
  margin: 0;
  color: ${(props) => props.primary || props.theme.dateLabel};
  border-radius: 118px;
  padding: 5px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 14px;
  font-weight: 600;
  background-color: ${(props) =>
    props.theme.dark ? props.theme.surfaceSecondary : props.secondary || '#e7edf9'};
  height: 24px;
  white-space: nowrap;
`;

const TreadLabel: React.FC<DateLabelProps> = ({ reply, colors }) => {
  const theme = useTheme();
  return (
    <Container>
      <Line />
      <StyledDateLabel
        primary={theme.dark ? undefined : colors?.primary}
        secondary={colors?.secondary}
      >
        {reply} {reply > 1 ? 'replies' : 'reply'}
      </StyledDateLabel>
      <Line />
    </Container>
  );
};

export default TreadLabel;
