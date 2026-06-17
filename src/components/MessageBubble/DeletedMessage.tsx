import { Text } from 'react-native';
import { DeleteIcon } from '../../assets/icons';
import { styled } from 'styled-components/native';

const ReplyContainer = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding-top: 5px;

  @media (max-width: 399px) {
    font-size: 14px;
  }
`;

const IconContainer = styled.View`
  padding: 5px;
  background-color: #cccccc;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const DeletedMessage = () => {
  return (
    <ReplyContainer testID="message-deleted" accessibilityLabel="message-deleted">
      <IconContainer>
        <DeleteIcon width={18} height={18} fill="#8C8C8C" />
      </IconContainer>
      <Text style={{ margin: 0, color: '#8C8C8C' }}>
        This message was deleted.
      </Text>
    </ReplyContainer>
  );
};
