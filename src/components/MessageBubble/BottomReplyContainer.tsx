import { FC, useMemo } from 'react';
import { composeName } from '../../helpers/displayName';
import { IReply, IUser } from '../../types/types';
import { Avatar } from './Avatar';
import { styled } from 'styled-components/native';
import { Text, View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useSelector } from 'react-redux';
import type { RootState } from '../../roomStore';

interface BottomReplyContainerProps {
  isUser: boolean;
  reply: IReply[];
  onClick: () => void;
}

const ReplyContainer = styled.TouchableOpacity<{ isUser: boolean }>`
  background-color: ${({ theme }) => theme.surface};
  border: 0.5px solid ${({ theme }) => theme.border};
  padding: 3px 10px 3px 14px;
  border-radius: 14px;
  flex-direction: row;
  align-items: center;
  gap: 6px;

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
  // The repliers' real names: a reply restored from cache carries only the
  // sender's id, so resolve through the same directory the bubbles use.
  const usersSet = useSelector((state: RootState) => state.rooms.usersSet);
  const nameOf = (u: any): string => {
    const raw = String(u?.id || '');
    const entry = usersSet?.[raw.split('@')[0]] || usersSet?.[raw];
    const full = entry
      ? composeName(entry.firstName, entry.lastName) || entry.name
      : '';
    return full || u?.name || '';
  };
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
              username={nameOf(item)}
              textSize={10}
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
