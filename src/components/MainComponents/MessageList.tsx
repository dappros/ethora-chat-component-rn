import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, StyleSheet, FlatList, Image } from "react-native";
import { IMessage, User, IConfig } from "../../types/types";
import Composing from "../styled/StyledInputComponents/Composing";
import TreadLabel from "../styled/TreadLabel";
import { MessageContainer } from "./MessageContainer";
import { useRoomState } from "../../hooks/useRoomState";
import Loader from "../styled/Loader";
import { SvgUri } from "react-native-svg";

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

  let lastDateLabel: string | null = null;

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
      return addReplyMessages
        .filter(
          (item: IMessage) =>
            item.roomJid === roomJID &&
            item.isReply &&
            item.isReply === "true" &&
            item.mainMessage &&
            JSON.parse(item.mainMessage).id === activeMessage?.id
        )
        .reverse();
    } else {
      return addReplyMessages
        .filter(
          (item: IMessage) =>
            item.showInChannel === "true" ||
            ((!item.isReply || item.isReply === "false") && !item.mainMessage)
        )
        .reverse();
    }
  }, [addReplyMessages, isReply, roomJID, activeMessage]);

  const flatListRef = useRef<FlatList<IMessage>>(null);
  const previousMessageCount = useRef(memoizedMessages.length);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || loading || !memoizedMessages.length) return;

    setIsLoadingMore(true);
    try {
      await loadMoreMessages(
        memoizedMessages[0].roomJid,
        30,
        Number(memoizedMessages[memoizedMessages.length - 1].id)
      );
    } catch (error) {
      console.error("Error loading more messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [memoizedMessages, isLoadingMore, loadMoreMessages]);

  const renderMessage = useCallback(
    ({ item }: { item: IMessage }) => {
      const messageDate = new Date(item.date).toDateString();
      const showDateLabel = messageDate !== lastDateLabel;
      lastDateLabel = messageDate;

      return (
        <MessageContainer
          CustomMessage={CustomMessage}
          message={item}
          activeMessage={activeMessage}
          config={config}
          walletAddress={user.walletAddress}
          isReply={isReply}
          showDateLabel={showDateLabel}
        />
      );
    },
    [CustomMessage, activeMessage, config, user.walletAddress, isReply]
  );

  // useEffect(() => {
  //   if (
  //     flatListRef.current &&
  //     previousMessageCount.current !== memoizedMessages.length
  //   ) {
  //     flatListRef.current.scrollToOffset({ animated: false, offset: 0 });
  //   }
  //   previousMessageCount.current = memoizedMessages.length;
  // }, [memoizedMessages]);

  const BackgroundImage = useMemo(() => {
    const image = config?.backgroundChat?.image;

    if (image) {
      if (typeof image === "function") {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return (
          <SvgComponent
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
        );
        // return <image width="100%" height="100%" />
      } else {
        return <Image source={image} style={styles.image} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: config?.backgroundChat?.color || "#F3F6FC" },
      ]}
    >
      {BackgroundImage}
      {/* {config?.backgroundChat?.image &&
      config?.backgroundChat?.image.endsWith(".svg") ? (
        <SvgUri
          width={"100%"}
          height={"100%"}
          uri={config?.backgroundChat?.image}
        />
      ) : (
        <Image source={config?.backgroundChat?.image} style={styles.image} />
      )} */}
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
        ref={flatListRef}
        data={memoizedMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id.toString()}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        inverted
        onScroll={(e) => {
          if (e.nativeEvent.contentOffset.y === 0) {
            handleLoadMore();
          }
        }}
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
    position: "relative",
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 10,
    flexGrow: 1,
  },
  image: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
});
