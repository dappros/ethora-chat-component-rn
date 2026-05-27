/** @format */

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
  ImageSourcePropType,
} from 'react-native';
import { IMessage, User, IConfig, IRoom } from '../../types/types';
import Composing from '../styled/StyledInputComponents/Composing';
import TreadLabel from '../styled/TreadLabel';
import { MessageContainer } from './MessageContainer';
import { useRoomState } from '../../hooks/useRoomState';
import Loader from '../styled/Loader';
import { ArowDownIcon } from '../../assets/icons';
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';

interface MessageListProps<TMessage extends IMessage> {
  CustomMessage?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
  }>;
  CustomDaySeparator?: React.ComponentType<{
    date: Date;
    formattedDate: string;
  }>;
  CustomNewMessageLabel?: React.ComponentType<{
    color?: string;
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
  CustomDaySeparator,
  CustomNewMessageLabel,
  user,
  loadMoreMessages,
  roomJID,
  config,
  loading,
  isReply,
  activeMessage,
}: MessageListProps<TMessage>) => {
  const { composing, messages, composingList } = useRoomState(roomJID)
    .room! as IRoom;
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const [isContentOffset, setIsContentOffset] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isScrollBlocked, setIsScrollBlocked] = useState(false);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);

  const flatListRef = useRef<FlatList<IMessage>>(null);

  const addReplyMessages = useMemo(() => {
    return messages.map((message: IMessage) => {
      const newMessage = {
        ...message,
        reply: messages.filter(
          (mess: IMessage) =>
            !!mess.mainMessage &&
            JSON.parse(mess.mainMessage).id === message.id &&
            !mess.isDeleted
        ),
      };
      return newMessage;
    });
  }, [messages]);

  const memoizedMessages = useMemo(() => {
    const nonDeletedMessages = addReplyMessages.filter(
      (item: IMessage) => !item.isDeleted
    );

    let filtered: IMessage[];
    if (isReply) {
      filtered = nonDeletedMessages.filter(
        (item: IMessage) =>
          item.roomJid === roomJID &&
          item.isReply &&
          item.isReply === 'true' &&
          item.mainMessage &&
          JSON.parse(item.mainMessage).id === activeMessage?.id
      );
    } else {
      filtered = nonDeletedMessages.filter(
        (item: IMessage) =>
          item.showInChannel === 'true' ||
          ((!item.isReply || item.isReply === 'false') && !item.mainMessage)
      );
    }

    // Explicit chronological sort by stanza-id timestamp (microseconds-
    // since-epoch encoded in the id). Without this, MAM history that
    // streams in across multiple ticks visibly reorders itself:
    // insertMessageWithDelimiter inserts new arrivals at the slot
    // matching their date.toString() comparison, but redux state can
    // emit intermediate snapshots between dispatches, so the FlatList
    // briefly renders messages out-of-order until the final batch
    // settles. Sorting here makes each render a stable, ordered view —
    // even mid-stream — so the user sees them appear from oldest to
    // newest with no swap animation.
    const sorted = filtered.slice().sort((a, b) => {
      const aNum = new Date(a?.date as any).getTime() || 0;
      const bNum = new Date(b?.date as any).getTime() || 0;
      return aNum - bNum;
    });
    return sorted;
  }, [addReplyMessages, isReply, roomJID, activeMessage]);

  const handleLoadMore = useCallback(async () => {
    if (
      loading ||
      isLoadingMore ||
      !memoizedMessages.length ||
      isScrollBlocked
    ) {
      return;
    }

    const oldestMessage = memoizedMessages[0];
    if (!oldestMessage || !oldestMessage.id) {
      return;
    }

    setIsLoadingMore(true);
    setIsScrollBlocked(true);

    try {
      await loadMoreMessages(
        oldestMessage.roomJid || roomJID,
        15,
        Number(oldestMessage.id)
      );
    } catch (error) {
      console.error(error);
    } finally {
      setTimeout(() => {
        setIsLoadingMore(false);
        setIsScrollBlocked(false);
      }, 500);
    }
  }, [
    memoizedMessages,
    loadMoreMessages,
    loading,
    isLoadingMore,
    isScrollBlocked,
    roomJID,
  ]);

  const dataMessages = useMemo(() => {
    return memoizedMessages.slice().reverse();
  }, [memoizedMessages]);

  const renderMessage = useCallback(
    ({ item, index }: { item: IMessage; index: number }) => {
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
          CustomDaySeparator={CustomDaySeparator}
          CustomNewMessageLabel={CustomNewMessageLabel}
          message={item}
          activeMessage={activeMessage}
          config={config}
          walletAddress={user.xmppUsername || user.walletAddress}
          isReply={isReply}
          showDateLabel={showDateLabel}
        />
      );
    },
    [
      activeMessage,
      config,
      user.xmppUsername,
      user.walletAddress,
      isReply,
      memoizedMessages.length,
    ]
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
    } else if (!isLoadingMore && hasUserScrolled) {
      setShowNewMessageIndicator(true);
    }
  }, [isUserAtBottom, scrollToBottom, isLoadingMore, hasUserScrolled]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const contentOffset = event.nativeEvent.contentOffset.y;

      // Don't force-dismiss the keyboard on every scroll event — any
      // touch on the message list used to close it, which made replying
      // to a long thread feel broken. Drag-to-dismiss still works via
      // FlatList's keyboardDismissMode="interactive" below.

      if (contentOffset > 150 && !hasUserScrolled) {
        setHasUserScrolled(true);
      }

      if (contentOffset < 150) {
        setIsContentOffset(true);
        setShowNewMessageIndicator(false);
        setIsUserAtBottom(true);
      } else {
        setIsContentOffset(false);
        if (hasUserScrolled) {
          setShowNewMessageIndicator(true);
        }
        setIsUserAtBottom(false);
      }
    },
    [hasUserScrolled]
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
    setHasUserScrolled(false);
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
  }, [roomJID]);

  const BackgroundImage = useMemo(() => {
    const image = config?.backgroundChat?.image;

    if (image) {
      if (typeof image === 'function') {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return <SvgComponent width="100%" />;
      } else {
        return <Image source={image as ImageSourcePropType} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: config?.backgroundChat?.color || '#F3F6FC' },
      ]}
    >
      <View style={styles.backgroundImageContainer}>{BackgroundImage}</View>
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
        keyExtractor={(item) => item.id.toString()}
        onEndReached={handleLoadMore}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onEndReachedThreshold={0.1}
        scrollEventThrottle={16}
        onLayout={handleLayout}
        inverted={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.flatListContent}
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
            { backgroundColor: config?.colors?.secondary },
          ]}
          onPress={handleNewMessageIndicatorPress}
        >
          <ArowDownIcon />
        </TouchableOpacity>
      )}
      {config?.customTypingIndicator?.enabled && composing && (
        <CustomTypingIndicator
          usersTyping={composingList || ['User']}
          text={config.customTypingIndicator.text}
          position={config.customTypingIndicator.position || 'bottom'}
          styles={config.customTypingIndicator.styles}
          customComponent={config.customTypingIndicator.customComponent}
          isVisible={composing}
        />
      )}

      {!config?.customTypingIndicator?.enabled &&
        config?.disableHeader &&
        composing && <Composing usersTyping={composingList || ['User']} />}
    </View>
  );
};

export default MessageList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  flatListContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  messageList: {
    paddingHorizontal: 10,
    flexGrow: 1,
    backgroundColor: '#434343',
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
