import styled from 'styled-components/native';
export const CustomDivider = styled.View<{
  configColor?: string;
}>`
  padding: 1px;
  height: 1px;
  width: 100%;
  background-color: ${(props) =>
    props.configColor ? props.configColor : '#0052CD'};
`;
