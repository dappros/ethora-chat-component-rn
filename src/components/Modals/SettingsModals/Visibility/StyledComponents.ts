import styled from 'styled-components/native';

export const Container = styled.View``;

export const Title = styled.View`
  font-size: 16px;
  font-weight: bold;
`;

export const Description = styled.View`
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 32px;
`;

export const RadioGroup = styled.View`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const RadioLabel = styled.View`
  display: flex;
  align-items: start;
  font-size: 14px;
  gap: 8px;
`;

// export const RadioInput = styled.input<{radioColor?: string}>`
//   accent-color: ${({radioColor}) => radioColor || '#0052CD'};
//   margin: 0px;
// `;
