import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ScrollView,
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  FlatList,
} from "react-native";
import { IMessage, User, IConfig } from "../../types/types";
import Composing from "../styled/StyledInputComponents/Composing";
import TreadLabel from "../styled/TreadLabel";
import { MessageContainer } from "./MessageContainer";
import { useRoomState } from "../../hooks/useRoomState";
import Loader from "../styled/Loader";

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
    amount?: number
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
  const { composing, messages } = useRoomState(roomJID).room;
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const addReplyMessages = useMemo(() => {
    return messages.map((message) => {
      const newMessage = {
        ...message,
        reply: messages.filter(
          (mess) =>
            !!mess.mainMessage && JSON.parse(mess.mainMessage).id === message.id
        ),
      };
      return newMessage;
    });
  }, [messages]);

  const memoizedMessages = useMemo(() => {
    if (isReply) {
      return addReplyMessages.filter(
        (item: IMessage) =>
          item.roomJid === roomJID &&
          item.isReply &&
          item.isReply === "true" &&
          item.mainMessage &&
          JSON.parse(item.mainMessage).id === activeMessage?.id
      );
    } else {
      return addReplyMessages.filter(
        (item: IMessage) =>
          item.showInChannel === "true" ||
          ((!item.isReply || item.isReply === "false") && !item.mainMessage)
      );
    }
  }, [addReplyMessages, isReply, roomJID, activeMessage]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !memoizedMessages.length || loading) return;

    setIsLoadingMore(true);
    try {
      await loadMoreMessages(
        memoizedMessages[0].roomJid,
        30,
        Number(memoizedMessages[0].id)
      );
    } catch (error) {
      console.error("Error loading more messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [memoizedMessages, isLoadingMore, loadMoreMessages]);

  const renderMessage = useCallback(
    ({ item }: { item: IMessage }) => {
      return (
        <MessageContainer
          CustomMessage={CustomMessage}
          message={item}
          activeMessage={activeMessage}
          config={config}
          walletAddress={user.walletAddress}
          isReply={isReply}
          showDateLabel={true} // Date labels can be handled if needed
        />
      );
    },
    [CustomMessage, activeMessage, config, user.walletAddress, isReply]
  );

  return (
    <View style={styles.container}>
      {loading && <Loader color={config?.colors?.primary} />}
      {activeMessage && (
        <View>
          {CustomMessage && (
            <CustomMessage
              message={activeMessage}
              isUser={activeMessage.user.id === user.walletAddress}
              isReply={isReply}
            />
          )}
          <TreadLabel reply={memoizedMessages.length} colors={config?.colors} />
        </View>
      )}
      <FlatList
        data={memoizedMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id.toString()}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.1}
        ListFooterComponent={
          isLoadingMore ? <Loader color={config?.colors?.primary} /> : null
        }
      />
      {composing && config?.disableHeader && (
        <Composing usersTyping={["User"]} />
      )}
    </View>
  );
};

export default MessageList;

const styles = StyleSheet.create({
  container: {
    paddingBottom: 80,
    flex: 1,
    backgroundColor: "#F3F6FC",
  },
  messageList: {
    paddingHorizontal: 10,
    flexGrow: 1,
  },
});
