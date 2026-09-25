import { FC, useMemo } from 'react';
import { IReply, IUser } from '../../types/types';
import { Avatar } from './Avatar';
import { styled } from 'styled-components/native';
import { Platform, Text, View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';

interface BottomReplyContainerProps {
  isUser: boolean;
  reply: IReply[];
  onClick: () => void;
}

const ReplyContainer = styled.TouchableOpacity<{ isUser: boolean }>`
  background-color: ${({ theme }) => theme.surface};
  left: ${(props) => (!props.isUser ? '10px' : 'auto')};
  right: ${(props) => (props.isUser ? '10px' : 'auto')};
  padding: 4px 8px 4px 16px;
  border-radius: 20px;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 0;

  ${({ theme }) =>
    Platform.select({
      // The light shadow is a soft bluish-grey tuned for a white card; on
      // the dark palette that would read as a glow, so use the theme shadow.
      ios: `
      shadow-color: ${theme.dark ? theme.shadow : 'rgba(185, 198, 199, 1)'};
      shadow-offset: 0px 0px;
      shadow-opacity: 1;
      shadow-radius: 8px;
    `,
      android: `
      elevation: 8;
    `,
    })}
`;

const AvatarCircle = styled.View`
  height: 24px;
  width: 24px;
  margin-left: -10px;
`;

const CircleCurrent = styled.View`
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 50%;
  background-color: ${({ theme }) => theme.surface};
`;

const CircleCurrentText = styled.Text`
  color: ${({ theme }) => theme.textSecondary};
  font-size: 10px;
  font-weight: 100;
`;

const CounterRepliesText = styled.Text`
  font-size: 12px;
  color: ${({ theme }) => theme.primary};
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const BottomReplyContainer: FC<BottomReplyContainerProps> = ({
  isUser,
  reply,
  onClick,
}) => {
  const theme = useTheme();
  const uniqueUsers: IUser[] = useMemo(() => {
    return Object.values(
      reply.reduce<Record<string, IUser>>((acc, item) => {
        if (!acc[item.user.id]) {
          acc[item.user.id] = {
            ...item.user,
          };
        }
        return acc;
      }, {})
    );
  }, [reply]);

  return (
    <ReplyContainer onPress={onClick} isUser={isUser}>
      <View style={{ flexDirection: 'row' }}>
        {uniqueUsers.slice(0, 3).map((item) => (
          <AvatarCircle key={item.id}>
            <Avatar
              username={item.name}
              style={{
                height: '100%',
                width: '100%',
                borderWidth: 1,
                borderColor: theme.border,
                borderStyle: 'solid',
                fontSize: 10,
              }}
            />
          </AvatarCircle>
        ))}
        {uniqueUsers.length > 3 && (
          <AvatarCircle>
            <CircleCurrent>
              <CircleCurrentText>+{uniqueUsers.length - 3}</CircleCurrentText>
            </CircleCurrent>
          </AvatarCircle>
        )}
      </View>
      <CounterRepliesText>
        {reply.length} {reply.length > 1 ? 'replies' : 'reply'}
      </CounterRepliesText>
    </ReplyContainer>
  );
};
