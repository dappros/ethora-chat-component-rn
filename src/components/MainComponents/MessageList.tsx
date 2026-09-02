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
  Text,
  StyleSheet,
  FlatList,
  Image,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableOpacity,
  ImageSourcePropType,
} from 'react-native';
import { IMessage, User, IConfig, IRoom } from '../../types/types';
import { msgSortableMs } from '../../roomStore/roomsSlice';
import Composing from '../styled/StyledInputComponents/Composing';
import TreadLabel from '../styled/TreadLabel';
import { MessageContainer } from './MessageContainer';
import { useRoomState } from '../../hooks/useRoomState';
import Loader from '../styled/Loader';
import { ArowDownIcon } from '../../assets/icons';
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';
import { getIconColor } from '../../helpers/getIconColor';

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
  /**
   * Fired whenever the "read up to" boundary changes: `null` while the
   * user is at the bottom (everything is read), or the timestamp of the
   * newest message they'd actually seen when they scrolled away from it.
   * Lets the host mark only what was actually viewed as read instead of
   * stamping "now" on unmount/leave, which would wrongly clear unread
   * messages the user scrolled up and never got back down to.
   */
  onReadBoundaryChange?: (boundaryTs: number | null) => void;
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
  onReadBoundaryChange,
}: MessageListProps<TMessage>) => {
  const { composing, messages, composingList } = useRoomState(roomJID)
    .room! as IRoom;
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isScrollBlocked, setIsScrollBlocked] = useState(false);
  // Count of messages that arrived while the user was scrolled up.
  // Renders as a badge on the scroll-to-bottom arrow so they know how
  // much they're missing without having to scroll to find out.
  const [unreadWhileScrolledUp, setUnreadWhileScrolledUp] = useState(0);
  // Newest message timestamp at the moment the user scrolled away from
  // the bottom. The badge counts only messages NEWER than this, so
  // back-pagination (loading OLDER history while scrolled up) never
  // inflates the count. Was previously a message-COUNT snapshot, which
  // wrongly counted back-paginated old messages as "new" (Android repro).
  const newestSeenTsRef = useRef<number | null>(null);
  // Refs mirror the viewport state synchronously. The auto-follow logic
  // runs from FlatList callbacks where setState hasn't necessarily
  // committed yet; relying on stale React state is what caused the chat
  // to jump back to the bottom when a new message landed mid-scroll.
  const isUserAtBottomRef = useRef(true);
  const hasUserScrolledRef = useRef(false);

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
    const deduped = Array.from(
      new Map(sorted.map((m) => [m.id, m])).values()
    );
    return deduped;
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
    const base = memoizedMessages.slice().reverse();
    const boundaryTs = newestSeenTsRef.current;
    if (
      isUserAtBottomRef.current ||
      boundaryTs === null ||
      unreadWhileScrolledUp === 0
    ) {
      return base;
    }

    let lastNewIndex = -1;
    for (let i = 0; i < base.length; i++) {
      if (msgSortableMs(base[i]) > boundaryTs) {
        lastNewIndex = i;
      } else {
        break;
      }
    }

    if (lastNewIndex === -1) {return base;}

    const withDivider = base.slice();
    withDivider.splice(lastNewIndex + 1, 0, {
      id: 'delimiter-new-local',
      user: {
        id: 'system',
        name: undefined,
        token: '',
        refreshToken: '',
      } as any,
      date: new Date(boundaryTs).toISOString(),
      body: 'New Messages',
      roomJid: roomJID,
    } as IMessage);
    return withDivider;
  }, [memoizedMessages, isUserAtBottom, roomJID, unreadWhileScrolledUp]);

  const renderMessage = useCallback(
    ({ item, index }: { item: IMessage; index: number }) => {
      if (String(item.id).startsWith('delimiter-new')) {
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
            showDateLabel={false}
          />
        );
      }

      const messageDate = new Date(item.date).toDateString();
      let showDateLabel = false;

      let nextMessage = null;
      for (let i = index + 1; i < dataMessages.length; i++) {
        const candidate = dataMessages[i];
        if (!String(candidate.id).startsWith('delimiter-new')) {
          nextMessage = candidate;
          break;
        }
      }
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
      CustomDaySeparator,
      CustomMessage,
      CustomNewMessageLabel,
      dataMessages,
      isReply,
      user.xmppUsername,
      user.walletAddress,
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
    if (!isLoadingMore && flatListRef.current && isUserAtBottomRef.current) {
      scrollToBottom();
    } else if (!isLoadingMore && hasUserScrolledRef.current) {
      setShowNewMessageIndicator(true);
    }
  }, [scrollToBottom, isLoadingMore]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const contentOffset = event.nativeEvent.contentOffset.y;

      // Don't force-dismiss the keyboard on every scroll event — any
      // touch on the message list used to close it, which made replying
      // to a long thread feel broken. Drag-to-dismiss still works via
      // FlatList's keyboardDismissMode="interactive" below.

      if (contentOffset > 150 && !hasUserScrolledRef.current) {
        hasUserScrolledRef.current = true;
      }

      if (contentOffset < 150) {
        isUserAtBottomRef.current = true;
        setShowNewMessageIndicator(false);
        setIsUserAtBottom(true);
        // Back at the bottom — clear the unread-while-scrolled-up
        // counter so the badge disappears with the arrow.
        setUnreadWhileScrolledUp(0);
        newestSeenTsRef.current = null;
        onReadBoundaryChange?.(null);
      } else {
        isUserAtBottomRef.current = false;
        if (hasUserScrolledRef.current) {
          setShowNewMessageIndicator(true);
        }
        if (newestSeenTsRef.current === null) {
          // Snapshot the NEWEST message's timestamp the moment the user
          // first leaves the bottom. Anything newer than this that
          // arrives later is genuinely "new"; older history loaded by
          // back-pagination is < this and never counts.
          newestSeenTsRef.current = memoizedMessages.reduce(
            (mx: number, m: IMessage) => {
              const t = msgSortableMs(m);
              return t > mx ? t : mx;
            },
            0
          );
          onReadBoundaryChange?.(newestSeenTsRef.current);
        }
        setIsUserAtBottom(false);
      }
    },
    [memoizedMessages, onReadBoundaryChange]
  );

  // Keep the badge in sync with messages that arrive while the user is
  // scrolled up. Count ONLY messages newer than the newest-seen snapshot
  // — so loading older history (back-pagination) doesn't inflate it.
  useEffect(() => {
    if (isUserAtBottomRef.current) {return;}
    if (newestSeenTsRef.current === null) {return;}
    const since = newestSeenTsRef.current;
    const count = memoizedMessages.reduce(
      (n: number, m: IMessage) => (msgSortableMs(m) > since ? n + 1 : n),
      0
    );
    setUnreadWhileScrolledUp(count);
  }, [memoizedMessages, isUserAtBottom]);

  const handleLayout = () => {
    isUserAtBottomRef.current = true;
    hasUserScrolledRef.current = false;
    setIsUserAtBottom(true);
  };

  const handleNewMessageIndicatorPress = () => {
    isUserAtBottomRef.current = true;
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
    setUnreadWhileScrolledUp(0);
    newestSeenTsRef.current = null;
    onReadBoundaryChange?.(null);
    scrollToBottom();
  };

  useEffect(() => {
    hasUserScrolledRef.current = false;
    isUserAtBottomRef.current = true;
    setShowNewMessageIndicator(false);
    setIsUserAtBottom(true);
    setUnreadWhileScrolledUp(0);
    newestSeenTsRef.current = null;
    onReadBoundaryChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        data={dataMessages}
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
        keyboardDismissMode={
          config?.keepKeyboardOpenOnScroll ? 'none' : 'interactive'
        }
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
            { backgroundColor: getIconColor(config) },
          ]}
          onPress={handleNewMessageIndicatorPress}
        >
          {/* White chevron on the saturated FAB. The icon's default
              color is white, which was invisible against the previous
              light `secondary` background — hence "no icon". */}
          <ArowDownIcon color="#FFFFFF" width={22} height={22} />
          {unreadWhileScrolledUp > 0 && (
            <View style={styles.newMessageBadge}>
              <Text style={styles.newMessageBadgeText}>
                {unreadWhileScrolledUp > 99 ? '99+' : unreadWhileScrolledUp}
              </Text>
            </View>
          )}
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
    backgroundColor: '#0052CD',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    // Lift the FAB off the chat background so it reads as a button.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  newMessageText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  newMessageBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    // Fixed red so it stays distinct from the (primary-coloured) FAB,
    // with a white ring to separate the two.
    backgroundColor: '#E53935',
    borderWidth: 2,
    borderColor: '#fff',
  },
  newMessageBadgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 11,
  },
});
