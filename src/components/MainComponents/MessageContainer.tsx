import React, { FC, Fragment, memo, useMemo } from 'react';
import { IConfig, IMessage } from '../../types/types';
import { isOwnMessage } from '../../helpers/isOwnMessage';
import DateLabel from '../styled/DateLabel';
import SystemMessage from './SystemMessage';
import NewMessageLabel from '../styled/NewMessageLabel';
import {
  Message,
} from '../styled/StyledComponents';
import { View } from 'react-native';

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

const MessageContainerImpl: FC<MessageContainerProps> = ({
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
  // Bug #41: `message.user.id === walletAddress` used to treat two
  // empty/undefined ids as a match, briefly rendering catch-up messages
  // from other users as our own. isOwnMessage() never does that.
  const isUser = isOwnMessage(message, walletAddress);

  const messageDate = new Date(message.date);

  if (message?.isSystemMessage === 'true') {
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

  if (String(message?.id || '').startsWith('delimiter-new')) {
    return CustomNewMessageLabel ? (
      <CustomNewMessageLabel color={config?.colors?.primary} />
    ) : (
      <NewMessageLabel color={config?.colors?.primary} />
    );
  }

  const MessageComponent = CustomMessage || Message;

  return (
    <View key={message.id}>
      {showDateLabel &&
      !activeMessage &&
      !String(message.id || '').startsWith('delimiter-new') ? (
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
        {CustomMessage ? (
          <MessageComponent
            message={message}
            isUser={isUser}
            isReply={isReply}
          />
        ) : null}
      </MessageComponent>
    </View>
  );
};

export const MessageContainer = memo(MessageContainerImpl);
