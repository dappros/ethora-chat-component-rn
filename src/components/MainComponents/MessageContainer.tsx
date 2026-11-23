import React, { FC, Fragment, memo, useMemo } from 'react';
import { IConfig, IMessage } from '../../types/types';
import { isOwnMessage } from '../../helpers/isOwnMessage';
import DateLabel from '../styled/DateLabel';
import SystemMessage from './SystemMessage';
import NewMessageLabel from '../styled/NewMessageLabel';
import {
  Message,
} from '../styled/StyledComponents';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../../i18n/useT';
import { useTheme } from '../../hooks/useTheme';
import { useBlockedUserIds } from '../../hooks/useBlockedUserIds';
import { blockedIdOf } from '../../helpers/userBlock';
import { formatCallLogLabel } from '../../helpers/callLogMessage';
import { isScheduledCallMessage } from '../../booking/scheduledCall';
import ScheduledCallMessage from '../Booking/ScheduledCallMessage';

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
  const t = useT();
  const theme = useTheme();
  const blockedUserIds = useBlockedUserIds();
  const isSenderBlocked =
    !isUser &&
    blockedUserIds.length > 0 &&
    [message.user?.id, (message.user as any)?.userJID, (message.user as any)?.xmppUsername].some(
      (id) => !!id && blockedUserIds.includes(blockedIdOf(id))
    );

  const messageDate = new Date(message.date);

  // Before the system-message branch: the backend sends the invite from the
  // system account, but it is a card, not a centred pill.
  if (isScheduledCallMessage(message)) {
    return (
      <ScheduledCallMessage
        message={message}
        config={config}
        showDateLabel={showDateLabel}
        CustomDaySeparator={CustomDaySeparator}
      />
    );
  }

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
          // A call-log entry is labelled from its callLog meta at render
          // time so it follows the current language instead of being
          // frozen in whatever was active when the stanza landed.
          <SystemMessage
            messageText={
              message.callLog
                ? formatCallLogLabel(message.callLog, t, message.body)
                : message.body
            }
            colors={config?.colors}
          />
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

  if (isSenderBlocked) {
    return (
      <View key={message.id} style={styles.blockedRow}>
        <Text style={[styles.blockedText, { color: theme.textSecondary }]}>
          {`${t('message.blockedUserName')}: ${t('message.blockedUser')}`}
        </Text>
      </View>
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

const styles = StyleSheet.create({
  blockedRow: { paddingHorizontal: 16, paddingVertical: 6 },
  blockedText: { fontSize: 13, fontStyle: 'italic' },
});

export const MessageContainer = memo(MessageContainerImpl);
