import React from "react";
import styled from "styled-components/native";
import { Line } from "./StyledComponents";

interface DateLabelProps {
  date: Date;
  colors?: { primary?: string; secondary?: string };
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
  secondary?: string;
}>`
  margin: 0;
  border-radius: 118px;
  padding: 5px 8px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => props.secondary || "#E7EDF9"};
`;

export const StyledDateText = styled.Text<{ primary?: string }>`
  color: ${(props) => props.primary || "#0052cd"};
  font-size: 12px;
  font-weight: 400;
  line-height: 14px;
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
    label = "Today";
  } else if (sameDay(date, yesterday)) {
    label = "Yesterday";
  } else {
    const options: Intl.DateTimeFormatOptions = sameYear(date, today)
      ? { month: "long", day: "numeric" }
      : { month: "long", day: "numeric", year: "numeric" };
    label = date.toLocaleDateString("en-US", options);
  }

  return (
    <Container>
      <Line />
      <StyledDateLabel secondary={colors?.secondary}>
        <StyledDateText primary={colors?.primary}>{label}</StyledDateText>
      </StyledDateLabel>
      <Line />
    </Container>
  );
};

export default DateLabel;
