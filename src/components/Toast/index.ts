import styled from 'styled-components/native';

export const Notification = styled.View<{type: 'success' | 'error'}>`
  padding: 10px 15px;
  margin-top: 16px;
  color: ${({type}) => (type === 'success' ? '#10b981' : '#ef4444')};
  background: ${({type}) => (type === 'success' ? '#d1fae5' : '#fee2e2')};
  border: 1px solid ${({type}) => (type === 'success' ? '#10b981' : '#ef4444')};
  border-radius: 4px;
`;

export { Toast } from './Toast';
export type { ToastType } from './Toast';
