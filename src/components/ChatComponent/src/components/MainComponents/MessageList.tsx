import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Image,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import {IMessage, User, IConfig} from '../../types/types';
import Composing from '../styled/StyledInputComponents/Composing';
import TreadLabel from '../styled/TreadLabel';
import {MessageContainer} from './MessageContainer';
import {useRoomState} from '../../hooks/useRoomState';
import Loader from '../styled/Loader';
import { ArowDownIcon } from '../../assets/icons';

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
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const [isContentOffset, setIsContentOffset] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isScrollBlocked, setIsScrollBlocked] = useState(false);

  const flatListRef = useRef<FlatList<IMessage>>(null);

  const addReplyMessages = useMemo(() => {
    return messages.map(message => {
      const newMessage = {
        ...message,
        reply: messages.filter(
          mess =>
            !!mess.mainMessage &&
            JSON.parse(mess.mainMessage).id === message.id,
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
          item.isReply === 'true' &&
          item.mainMessage &&
          JSON.parse(item.mainMessage).id === activeMessage?.id,
      );
    } else {
      return addReplyMessages.filter(
        (item: IMessage) =>
          item.showInChannel === 'true' ||
          ((!item.isReply || item.isReply === 'false') && !item.mainMessage),
      );
    }
  }, [addReplyMessages, isReply, roomJID, activeMessage]);

  const handleLoadMore = useCallback(async () => {
    if (loading || !memoizedMessages.length || isScrollBlocked) return;

    setIsLoadingMore(true);
    setIsScrollBlocked(true);

    try {
      await loadMoreMessages(messages[0].roomJid, 15, Number(messages[0].id));
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setIsLoadingMore(false);
      setIsScrollBlocked(false);
      setIsContentOffset(false);
    }
  }, [messages, loadMoreMessages, loading, isScrollBlocked]);

  const dataMessages = useMemo(() => {
    return memoizedMessages.slice().reverse();
  }, [memoizedMessages]);

  const renderMessage = useCallback(
    ({item, index}: {item: IMessage; index: number}) => {
      const messageDate = new Date(item.date).toDateString();
      let showDateLabel = false;

      const nextMessage =
        index < dataMessages.length - 1 ? dataMessages[index + 1] : null;
      const nextMessageDate = nextMessage
        ? new Date(nextMessage.date).toDateString()
        : null;

      if (!nextMessage || messageDate !== nextMessageDate) {
        showDateLabel = true;
      }

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
    [
      activeMessage,
      config,
      user.walletAddress,
      isReply,
      memoizedMessages.length,
    ],
  );

  const scrollToBottom = useCallback(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({
        offset: 0,
        animated: true,
      });
    }
  }, [flatListRef]);

  const handleContentSizeChange = useCallback(() => {
    if (isContentOffset) {
      scrollToBottom();
      setIsContentOffset(false);
    }
    if (!isLoadingMore && flatListRef.current && isUserAtBottom) {
      scrollToBottom();
    } else if (!isLoadingMore) {
      setShowNewMessageIndicator(true);
    }
  }, [isUserAtBottom, scrollToBottom, isLoadingMore]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const contentOffset = event.nativeEvent.contentOffset.y;
      
      Keyboard.dismiss();

      if (contentOffset < 150) {
        setIsContentOffset(true);
        setShowNewMessageIndicator(false);
        setIsUserAtBottom(true);
      } else {
        setIsContentOffset(false);
        setShowNewMessageIndicator(true);
        setIsUserAtBottom(false);
      }
    },
    [],
  );

  const handleLayout = () => {
    setIsContentOffset(true);
    setIsUserAtBottom(true);
  };

  const handleNewMessageIndicatorPress = () => {
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
    scrollToBottom();
  };

  useEffect(() => {
    setIsUserAtBottom(
      messages[messages.length - 1].user.id === user.walletAddress,
    );
  }, [messages.length]);

  const BackgroundImage = useMemo(() => {
    const image = config?.backgroundChat?.image;

    if (image) {
      if (typeof image === 'function') {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return (
          <SvgComponent
            width="100%"
          />
        );
      } else {
        return <Image source={image} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  return (
    <View
      style={[
        styles.container,
        {backgroundColor: config?.backgroundChat?.color || '#F3F6FC'},
      ]}>
      <View style={styles.backgroundImageContainer}>
        {BackgroundImage}
      </View>
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
        data={memoizedMessages.slice().reverse()}
        renderItem={renderMessage}
        keyExtractor={item => item.id.toString()}
        onEndReached={handleLoadMore}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onEndReachedThreshold={0.5}
        scrollEventThrottle={16}
        onLayout={handleLayout}
        inverted={true}
        ListFooterComponent={
          loading && memoizedMessages.length > 15 ? (
            <Loader color={config?.colors?.primary} />
          ) : null
        }
      />
      {showNewMessageIndicator && (
        <TouchableOpacity
          style={[
            styles.newMessageIndicator,
            {backgroundColor: config?.colors?.secondary},
          ]}
          onPress={handleNewMessageIndicatorPress}>
          <ArowDownIcon />
        </TouchableOpacity>
      )}
      {composing && config?.disableHeader && (
        <Composing usersTyping={['User']} />
      )}
    </View>
  );
};

export default MessageList;

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 10,
    flexGrow: 1,
  },
  backgroundImageContainer: {
    width: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: -1,
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  newMessageIndicator: {
    position: 'absolute',
    width: 40,
    height: 40,
    bottom: 20,
    right: 20,
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 20,
  },
  newMessageText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
