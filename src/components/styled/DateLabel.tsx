import React from 'react';
import styled from 'styled-components/native';
import { Line } from './StyledComponents';
import { Text } from 'react-native';
import { getDateLabelColor } from '../../helpers/getDateLabelColor';

interface DateLabelProps {
  date: Date;
  colors?: { primary?: string; secondary?: string; dateLabel?: string };
}

const Container = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 100%;
  background-color: transparent;
  gap: 16px;
  margin: 16px 0;
`;

export const StyledDateLabel = styled.View<{
  bgColor?: string;
}>`
  margin: 0;
  border-radius: 118px;
  padding: 5px 8px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: ${({ bgColor }) => bgColor || '#e7edf9'};
`;

export const StyledDateText = styled.Text<{ color?: string }>`
  color: ${({ color }) => color || '#0052cd'};
  font-size: 12px;
  font-weight: 400;
  line-height: 14px;
  white-space: nowrap;
`;

const DateLabel: React.FC<DateLabelProps> = ({ date, colors }) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const sameYear = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear();

  let label: string;
  if (sameDay(date, today)) {
    label = 'Today';
  } else if (sameDay(date, yesterday)) {
    label = 'Yesterday';
  } else {
    const options: Intl.DateTimeFormatOptions = sameYear(date, today)
      ? { month: 'long', day: 'numeric' }
      : { month: 'long', day: 'numeric', year: 'numeric' };
    label = date.toLocaleDateString('en-US', options);
  }

  const textColor = getDateLabelColor({ colors });

  return (
    <Container>
      <Line />
      <StyledDateLabel bgColor={colors?.secondary}>
        <StyledDateText color={textColor}>{label}</StyledDateText>
      </StyledDateLabel>
      <Line />
    </Container>
  );
};

export default DateLabel;
