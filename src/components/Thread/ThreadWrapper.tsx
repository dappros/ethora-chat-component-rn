import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IMessage, User } from '../../types/types';
import {
  AlsoCheckbox,
  AlsoContainer,
  ChatContainer,
  ThreadContainer,
} from '../styled/StyledComponents';
import SendInput from '../styled/SendInput';
import { useDispatch, useStore } from 'react-redux';
import { RootState } from '../../roomStore';
import Loader from '../styled/Loader';
import { useT } from '../../i18n/useT';
import { parseMessageReference } from '../../helpers/parseMessageReference';
import { useXmppClient } from '../../context/xmppProvider';
import MessageList from '../MainComponents/MessageList';
import ModalHeaderComponent from '../Modals/ModalHeaderComponent';
import {
  deleteRoomMessage,
  setCloseActiveMessage,
  setEditAction,
  setLastViewedTimestamp,
} from '../../roomStore/roomsSlice';
import { EditWrapper } from '../MainComponents/EditWrapper';
import { useSendMessage } from '../../hooks/useSendMessage';
import { createMainMessageForThread } from '../../helpers/createMainMessageForThread';
import { useRoomState } from '../../hooks/useRoomState';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useTheme } from '../../hooks/useTheme';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
} from 'react-native';
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';

export const THREAD_HISTORY_PAGE_SIZE = 15;

interface ThreadWrapperProps {
  activeMessage: IMessage;
  user: User;
  customMessageComponent?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
  }>;
}

const ThreadWrapper: FC<ThreadWrapperProps> = ({
  activeMessage,
  user,
  customMessageComponent: CustomMessageComponent,
}) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  const { loading, roomsList, editAction, activeRoomJID } = useRoomState();
  const { config } = useChatSettingState();
  const theme = useTheme();
  const { sendMessage: sendMs, sendMedia: sendMessageMedia, sendEditMessage, isLastMessageFromUserAndProcessing } = useSendMessage();

  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [isChecked, setIsChecked] = useState<boolean>(false);
  const t = useT();
  const store = useStore<RootState>();

  const roomJid = activeMessage.roomJid;
  const room = roomsList?.[roomJid];
  const parentTs = Number(activeMessage.id);

  // One page request at a time, and never the same page twice: a page that
  // returns only reactions or receipts leaves the cursor where it was, and
  // repeating it would loop forever.
  const inFlightRef = useRef(false);
  const lastRequestKeyRef = useRef<string | null>(null);
  useEffect(() => {
    lastRequestKeyRef.current = null;
  }, [roomJid, activeMessage.id]);

  const slideAnim = useRef(new Animated.Value(300)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e, gestureState) => {
        return gestureState.x0 <= 100;
      },
      onMoveShouldSetPanResponder: (e, gestureState) => {
        return gestureState.x0 <= 100 && gestureState.dx > 0;
      },
      onPanResponderMove: (e, gestureState) => {
        if (gestureState.x0 <= 100 && gestureState.dx > 0) {
          slideAnim.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (e, gestureState) => {
        if (gestureState.x0 <= 100 && gestureState.dx > 150) {
          closeThread();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Reads the LATEST room state at call time (no stale closure), pages by the
  // server cursor like the main list does, and stops at the thread's parent:
  // every reply is newer than the message it answers.
  const loadMoreMessages = useCallback(
    async (chatJID: string, max: number, idOfMessageBefore?: number) => {
      if (!client || inFlightRef.current) return;
      const current = store.getState().rooms.rooms?.[chatJID];
      if (!current || current.historyComplete) return;

      const cursor = current.messageStats?.firstMessageTimestamp;
      const hint =
        typeof idOfMessageBefore === 'number' &&
        Number.isFinite(idOfMessageBefore)
          ? idOfMessageBefore
          : undefined;
      const candidates = [cursor, hint].filter(
        (n): n is number => typeof n === 'number' && Number.isFinite(n)
      );
      const before = candidates.length ? Math.min(...candidates) : undefined;
      if (before === undefined) return;
      if (Number.isFinite(parentTs) && before <= parentTs) return;

      const requestKey = `${chatJID}|${before}`;
      if (requestKey === lastRequestKeyRef.current) return;

      inFlightRef.current = true;
      lastRequestKeyRef.current = requestKey;
      setIsLoadingMore(true);
      try {
        await client
          .getHistoryStanza(chatJID, max, before)
          .catch((err: unknown) => {
            // Let the same page be retried later.
            lastRequestKeyRef.current = null;
            console.warn('getHistoryStanza failed', err);
          });
      } finally {
        inFlightRef.current = false;
        setIsLoadingMore(false);
      }
    },
    [client, store, parentTs]
  );

  // Replies of this parent already in the store.
  const replyCount = useMemo(() => {
    let n = 0;
    for (const m of room?.messages ?? []) {
      if (
        m.isReply === 'true' &&
        parseMessageReference(m.mainMessage)?.id === activeMessage.id
      ) {
        n += 1;
      }
    }
    return n;
  }, [room?.messages, activeMessage.id]);

  // Opening a thread whose parent is older than the loaded window: the list
  // has no replies to scroll, so nothing would ask for history. Keep paging
  // until the cursor reaches the parent (or the archive ends).
  const cursor = room?.messageStats?.firstMessageTimestamp;
  const historyComplete = Boolean(room?.historyComplete);
  useEffect(() => {
    if (historyComplete || isLoadingMore) return;
    if (!Number.isFinite(parentTs)) return;
    if (typeof cursor !== 'number' || cursor <= parentTs) return;
    loadMoreMessages(roomJid, THREAD_HISTORY_PAGE_SIZE, cursor);
  }, [
    cursor,
    historyComplete,
    isLoadingMore,
    parentTs,
    roomJid,
    loadMoreMessages,
  ]);

  const sendMessage = useCallback(
    (message: string) => {
      sendMs(
        message,
        roomJid,
        true,
        isChecked,
        createMainMessageForThread(activeMessage)
      );
    },
    [activeMessage, isChecked, roomJid, sendMs]
  );

  const sendMedia = useCallback(
    (data: any, type: string) => {
      return sendMessageMedia(
        data,
        type,
        roomJid,
        true,
        isChecked,
        createMainMessageForThread(activeMessage)
      );
    },
    [activeMessage, isChecked, roomJid, sendMessageMedia]
  );

  const sendStartComposing = useCallback(() => {
    if (config?.disableTypingIndicator) {
      return;
    }
    client?.sendTypingRequestStanza(
      activeMessage.roomJid,
      `${user.firstName} ${user.lastName}`,
      true
    );
  }, [
    client,
    config?.disableTypingIndicator,
    user.firstName,
    user.lastName,
    activeMessage.roomJid,
  ]);

  const sendEndComposing = useCallback(() => {
    if (config?.disableTypingIndicator) {
      return;
    }
    client?.sendTypingRequestStanza(
      activeMessage.roomJid,
      `${user.firstName} ${user.lastName}`,
      false
    );
  }, [
    client,
    config?.disableTypingIndicator,
    user.firstName,
    user.lastName,
    activeMessage.roomJid,
  ]);

  const onCloseEdit = () => {
    dispatch(setEditAction({ isEdit: false }));
  };

  const closeThread = () => {
    dispatch(setCloseActiveMessage({ chatJID: activeMessage.roomJid }));
    dispatch(setEditAction({ isEdit: false }));
  };

  useEffect(() => {
    if (activeMessage?.activeMessage) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [activeMessage?.activeMessage]);

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.threadContainer,
        { backgroundColor: theme.chatBackground },
        { transform: [{ translateX: slideAnim }] },
        // ...config?.chatRoomStyles,
      ]}
    >
      <ModalHeaderComponent
        headerTitle={t('thread.title')}
        handleCloseModal={closeThread}
      />
      {isLoadingMore && replyCount === 0 && (
        <View
          testID="thread-history-loader"
          pointerEvents="none"
          style={styles.historyLoader}
        >
          <Loader size={24} color={theme.primary} />
        </View>
      )}
      <MessageList
        loadMoreMessages={loadMoreMessages}
        CustomMessage={CustomMessageComponent}
        user={user}
        roomJID={activeMessage.roomJid}
        config={config}
        loading={isLoadingMore}
        activeMessage={activeMessage}
        isReply
      />
      <AlsoContainer onPress={() => setIsChecked((prev) => !prev)}>
        <AlsoCheckbox
          accentColor={isChecked ? theme.primary : theme.surface}
          // checked={isChecked}
          // onPress={() => setIsChecked(!isChecked)}
        />
        <Text style={{ color: theme.text }}>{t('thread.alsoSendTo')}</Text>
        <TouchableOpacity onPress={closeThread}>
          <Text
            style={{
              color: theme.primary,
              fontWeight: 500,
            }}
          >
            {room?.name}
          </Text>
        </TouchableOpacity>
      </AlsoContainer>
      {editAction && editAction.isEdit && (
        <EditWrapper text={editAction.text || ''} onClose={onCloseEdit} />
      )}
      <SendInput
        editMessage={editAction && editAction.text}
        sendMedia={sendMedia}
        sendMessage={editAction && editAction.isEdit ? sendEditMessage : sendMessage}
        config={config}
        onFocus={sendStartComposing}
        onBlur={sendEndComposing}
        isLoading={loading}
        isMessageProcessing={isLastMessageFromUserAndProcessing(
          activeMessage.roomJid
        )}
      />

      {config?.customTypingIndicator?.enabled &&
        (config.customTypingIndicator.position === 'overlay' ||
          config.customTypingIndicator.position === 'floating') &&
        roomsList[activeMessage.roomJid]?.composing && (
          <CustomTypingIndicator
            usersTyping={
              roomsList[activeMessage.roomJid]?.composingList || ['User']
            }
            text={config.customTypingIndicator.text}
            position={config.customTypingIndicator.position}
            styles={config.customTypingIndicator.styles}
            customComponent={config.customTypingIndicator.customComponent}
            isVisible={roomsList[activeMessage.roomJid]?.composing || false}
          />
      )}
    </Animated.View>
  );
};

export default ThreadWrapper;

const styles = StyleSheet.create({
  threadContainer: {
    zIndex: 999,
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#f3f6fc',
    flexDirection: 'column',
    justifyContent: 'space-between',
    flex: 1,
  },
  historyLoader: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 18,
  },
});
