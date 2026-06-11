import { styled } from 'styled-components/native';
import { EmptyChatIllustration } from '../../assets/EmptyChatIllustration';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { getIconColor } from '../../helpers/getIconColor';

export const ChooseChatMessageContainer = styled.View`
  height: 100%;
  width: 100%;
  align-items: center;
  display: flex;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
`;

export const ChooseChatMessageContainerBoxText = styled.View`
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
`;

export const ChooseChatTitle = styled.Text`
  font-size: 16px;
  color: #141414;
  font-weight: 600;
`;

export const ChooseChatDescription = styled.Text`
  font-size: 14px;
  color: #141414;
`;

export const ChooseChatMessage = () => {
  const { config } = useChatSettingState();
  return (
    <ChooseChatMessageContainer>
      <EmptyChatIllustration color={getIconColor(config)} />
      <ChooseChatMessageContainerBoxText>
        <ChooseChatTitle>Start a Conversation</ChooseChatTitle>
        <ChooseChatDescription>
          Choose a chat to start messaging.
        </ChooseChatDescription>
      </ChooseChatMessageContainerBoxText>
    </ChooseChatMessageContainer>
  );
};
