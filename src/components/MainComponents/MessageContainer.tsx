import React, { FC, Fragment, useMemo } from "react";
import { IConfig, IMessage } from "../../types/types";
import DateLabel from "../styled/DateLabel";
import SystemMessage from "./SystemMessage";
import NewMessageLabel from "../styled/NewMessageLabel";
import {
  Message,
  MessageText,
  MessageTimestamp,
  UserName,
} from "../styled/StyledComponents";
import { View } from "react-native";

interface MessageContainerProps {
  CustomMessage?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
    className?: string;
  }>;
  CustomDaySeparator?: React.ComponentType<{
    date: Date;
    formattedDate: string;
  }>;
  CustomNewMessageLabel?: React.ComponentType<{
    color?: string;
  }>;
  message: IMessage;
  activeMessage?: IMessage;
  config?: IConfig;
  walletAddress: string;
  isReply: boolean;
  showDateLabel: boolean;
  className?: string;
}

export const MessageContainer: FC<MessageContainerProps> = ({
  CustomMessage,
  CustomDaySeparator,
  CustomNewMessageLabel,
  message,
  activeMessage,
  config,
  walletAddress,
  showDateLabel,
  isReply,
  className,
}) => {
  const isUser = message.user.id === walletAddress;

  const messageDate = new Date(message.date);

  if (message?.isSystemMessage === "true") {
    const SystemMessageComponent = config?.customSystemMessage;
    return (
      <Fragment key={message.id}>
        {showDateLabel && (
          CustomDaySeparator ? (
            <CustomDaySeparator 
              date={messageDate} 
              formattedDate={messageDate.toLocaleDateString()} 
            />
          ) : (
            <DateLabel date={messageDate} colors={config?.colors} />
          )
        )}
        {SystemMessageComponent ? (
          <SystemMessageComponent message={message} isUser={false} isReply={false} />
        ) : (
          <SystemMessage messageText={message.body} colors={config?.colors} />
        )}
      </Fragment>
    );
  }

  if (message?.id === "delimiter-new") {
    return CustomNewMessageLabel ? (
      <CustomNewMessageLabel color={config?.colors?.primary} />
    ) : (
      <NewMessageLabel color={config?.colors?.primary} />
    );
  }

  const MessageComponent = CustomMessage || Message;

  return (
    <View key={message.id}>
      {showDateLabel && !activeMessage && message.id !== "delimiter-new" ? (
        CustomDaySeparator ? (
          <CustomDaySeparator 
            date={messageDate} 
            formattedDate={messageDate.toLocaleDateString()} 
          />
        ) : (
          <DateLabel date={messageDate} colors={config?.colors} />
        )
      ) : null}
      <MessageComponent
        message={message}
        isUser={isUser}
        isReply={isReply}
        className={className}
      >
        {!CustomMessage ? (
          <>
            <MessageTimestamp>
              {messageDate.toLocaleTimeString()}
            </MessageTimestamp>
            <UserName>{message.user.name}: </UserName>
            <MessageText>{message.body}</MessageText>
          </>
        ) : (
          <MessageComponent
            message={message}
            isUser={isUser}
            isReply={isReply}
          />
        )}
      </MessageComponent>
    </View>
  );
};
