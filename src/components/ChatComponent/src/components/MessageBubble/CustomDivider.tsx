import styled from 'styled-components/native';
export const CustomDivider = styled.View<{
  configColor: string;
  configColorUser: string;
  isUser: boolean;
}>`
  margin: 1px 0;
  height: 1px;
  width: 100%;
  background-color: ${(props) =>
    props.isUser ? props.configColorUser || '#0052CD' : props.configColor || '#0052CD'};
`;
