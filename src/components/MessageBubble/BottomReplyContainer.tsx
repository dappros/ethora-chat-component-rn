import { FC, useMemo } from "react";
import { IReply, IUser } from "../../types/types";
import { Avatar } from "./Avatar";
import { styled } from "styled-components/native";
import { Platform, Text, View } from "react-native";

interface BottomReplyContainerProps {
  isUser: boolean;
  reply: IReply[];
  onClick: () => void;
}

const ReplyContainer = styled.TouchableOpacity<{ isUser: boolean }>`
  position: absolute;
  background-color: #ffffff;
  bottom: -25px;
  left: ${(props) => !props.isUser && "10px"};
  right: ${(props) => props.isUser && "10px"};
  padding: 4px 8px 4px 16px;
  border-radius: 20px;
  flex-direction: row;
  align-items: center;
  gap: 6px;

  ${Platform.select({
    ios: `
      shadow-color: rgba(185, 198, 199, 1);
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
  border: 1px solid #f0f0f0;
  border-radius: 50%;
  background-color: #ffffff;
`;

const CircleCurrentText = styled.Text`
  color: #8c8c8c;
  font-size: 10px;
  font-weight: 100;
`;

const CounterRepliesText = styled.Text`
  font-size: 12px;
  color: #0052cd;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const BottomReplyContainer: FC<BottomReplyContainerProps> = ({
  isUser,
  reply,
  onClick,
}) => {
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
      <View style={{ flexDirection: "row" }}>
        {uniqueUsers.slice(0, 3).map((item) => (
          <AvatarCircle key={item.id}>
            <Avatar
              username={item.name}
              style={{
                height: "100%",
                width: "100%",
                borderWidth: 1,
                borderColor: "#F0F0F0",
                borderStyle: "solid",
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
        {reply.length} {reply.length > 1 ? "replies" : "reply"}
      </CounterRepliesText>
    </ReplyContainer>
  );
};
