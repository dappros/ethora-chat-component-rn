import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {
  ScrollView,
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  FlatList,
} from 'react-native';
import {IMessage, User, IConfig} from '../../types/types';
import Composing from '../styled/StyledInputComponents/Composing';
import TreadLabel from '../styled/TreadLabel';
import {MessageContainer} from './MessageContainer';
import {useRoomState} from '../../hooks/useRoomState';

interface MessageListProps<TMessage extends IMessage> {
  CustomMessage?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
  }>;
  user: User;
  roomJID: string;
  loadMoreMessages: (
    chatJID: string,
    max: number,
    amount?: number,
  ) => Promise<void>;
  loading: boolean;
  config?: IConfig;
  isReply: boolean;
  activeMessage?: IMessage;
}

const MessageList = <TMessage extends IMessage>({
  CustomMessage,
  user,
  loadMoreMessages,
  roomJID,
  config,
  loading,
  isReply,
  activeMessage,
}: MessageListProps<TMessage>) => {
  const {composing, messages} = useRoomState(roomJID).room;

  const memoizedMessages = useMemo(() => {
    const addReplyMessages = messages.map(message => ({
      ...message,
      reply: messages.filter(
        mess =>
          !!mess.mainMessage && JSON.parse(mess.mainMessage).id === message.id,
      ),
    }));

    if (isReply) {
      return addReplyMessages.filter(
        (item: IMessage) =>
          item.roomJid === roomJID &&
          item.isReply &&
          item.isReply === 'true' &&
          item.mainMessage &&
          JSON.parse(item.mainMessage).id === activeMessage?.id,
      );
    }
    return addReplyMessages.filter(
      (item: IMessage) =>
        item.showInChannel === 'true' ||
        ((!item.isReply || item.isReply === 'false') && !item.mainMessage),
    );
  }, [messages, isReply]);

  const containerRef = useRef<ScrollView>(null);

  const handleScroll = (event: any) => {
    const {nativeEvent} = event;
    if (nativeEvent.contentOffset.y < 150 && !loading) {
      const firstMessage = memoizedMessages[0];
      if (firstMessage) {
        loadMoreMessages(roomJID, 30, Number(firstMessage.id));
      }
    }
  };

  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollToEnd({animated: true});
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [memoizedMessages.length]);

  let lastDateLabel: string | null = null;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={containerRef}
        style={styles.messageList}
        onScroll={handleScroll}
        scrollEventThrottle={16}>
        {loading && (
          <ActivityIndicator
            size="small"
            color={config?.colors?.primary || '#000'}
          />
        )}
        {activeMessage && (
          <>
            {CustomMessage && (
              <CustomMessage
                message={activeMessage}
                isUser={user.walletAddress === activeMessage.user.id}
                isReply={isReply}
              />
            )}
            <TreadLabel
              reply={memoizedMessages.length}
              colors={config?.colors}
            />
          </>
        )}
        {memoizedMessages.map(message => {
          const messageDate = new Date(message.date).toDateString();
          const showDateLabel = messageDate !== lastDateLabel;
          lastDateLabel = messageDate;

          return (
            <MessageContainer
              key={message.id}
              CustomMessage={CustomMessage}
              message={message}
              activeMessage={activeMessage}
              config={config}
              walletAddress={user.walletAddress}
              isReply={isReply}
              showDateLabel={showDateLabel}
            />
          );
        })}
        {config?.disableHeader && composing && (
          <Composing usersTyping={['User']} />
        )}
      </ScrollView>
    </View>
  );
};

export default MessageList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  messageList: {
    paddingHorizontal: 10,
    flexGrow: 1,
  },
});
