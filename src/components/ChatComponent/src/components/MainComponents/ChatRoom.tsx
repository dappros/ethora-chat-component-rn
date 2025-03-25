/** @format */

import React, {useState, useEffect, useCallback, useRef} from 'react';
import {ChatContainer, NonRoomChat} from '../styled/StyledComponents';
import {useDispatch} from 'react-redux';
import MessageList from './MessageList';
import SendInput from '../styled/SendInput';
import {
  deleteRoomMessage,
  setEditAction,
  setLastViewedTimestamp,
} from '../../roomStore/roomsSlice';
import Loader from '../styled/Loader';
import {useXmppClient} from '../../context/xmppProvider';
import ChatHeader from './ChatHeader';
import NoMessagesPlaceholder from './NoMessagesPlaceholder';
import NewChatModal from '../Modals/NewChatModal/NewChatModal';
import {EditWrapper} from './EditWrapper';
import {NoSelectedChatIcon} from '../../assets/icons';
import {ChooseChatMessage} from './ChooseChatMessage';
import {useRoomUrl} from '../../hooks/useRoomUrl';
import useMessageLoaderQueue from '../../hooks/useMessageLoaderQueue';
import {useSendMessage} from '../../hooks/useSendMessage';
import {useRoomInitialization} from '../../hooks/useRoomInitialization';
import {useRoomState} from '../../hooks/useRoomState';
import {useChatSettingState} from '../../hooks/useChatSettingState';
import {PanGestureHandler} from 'react-native-gesture-handler';
import {FlatList, Platform} from 'react-native';
import {IMessage} from '../../types/types';
import useAppState from '../../hooks/useAppState';
import {KeyboardAvoidingView} from 'native-base';

interface ChatRoomProps {
  CustomMessageComponent?: any;
  handleBackClick?: (value: boolean) => void;
}

const ChatRoom: React.FC<ChatRoomProps> = React.memo(
  ({CustomMessageComponent, handleBackClick}) => {
    const {client} = useXmppClient();
    const dispatch = useDispatch();

    const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

    const flatListRef = useRef<FlatList<IMessage>>(null);

    const {user, config} = useChatSettingState();
    const {
      roomsList,
      activeRoomJID,
      editAction,
      loading,
      globalLoading,
      roomMessages,
    } = useRoomState();
    const {sendMessage: sendMs, sendMedia: sendMessageMedia} = useSendMessage();

    const sendMessage = useCallback(
      (message: string) => {
        sendMs(message, activeRoomJID || '');
      },
      [activeRoomJID],
    );

    const sendMedia = useCallback(
      (data: any, type: string) => {
        sendMessageMedia(data, type, activeRoomJID || '');
      },
      [activeRoomJID],
    );

    const loadMoreMessages = useCallback(
      async (chatJID: string, max: number, idOfMessageBefore?: number) => {
        if (!isLoadingMore) {
          setIsLoadingMore(true);
          client?.getHistoryStanza(chatJID, max, idOfMessageBefore).then(() => {
            setIsLoadingMore(false);
          });
        }
      },
      [client, isLoadingMore],
    );

    const onCloseEdit = () => {
      dispatch(setEditAction({isEdit: false}));
    };

    useEffect(() => {
      dispatch(
        setLastViewedTimestamp({
          chatJID: activeRoomJID || '',
          timestamp: 0,
        }),
      );
      return () => {
        if (client) {
          client.actionSetTimestampToPrivateStoreStanza(
            activeRoomJID || '',
            new Date().getTime(),
            Object.keys(roomsList),
          );
        }
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID || '',
            timestamp: new Date().getTime(),
          }),
        );
        dispatch(
          deleteRoomMessage({
            roomJID: activeRoomJID || '',
            messageId: 'delimiter-new',
          }),
        );
      };
    }, [activeRoomJID]);

    useAppState({
      client: client,
      roomsList: roomsList,
      activeRoomJID: activeRoomJID,
    });

    useRoomUrl(activeRoomJID || '', roomsList, config);

    useRoomInitialization(
      activeRoomJID || '',
      roomsList,
      config,
      roomMessages.length,
    );

    const onGestureEvent = (event: {nativeEvent: {translationX: any}}) => {
      const {translationX} = event.nativeEvent;

      if (translationX > 100) {
        handleBackClick?.(false);
      }
    };

    if (Object.keys(roomsList)?.length < 1 && !loading && !globalLoading) {
      return (
        <NonRoomChat>
          No room. Let's create one!
          <NewChatModal />
        </NonRoomChat>
      );
    }

    if (!activeRoomJID || !roomsList?.[activeRoomJID]) {
      return <ChooseChatMessage />;
    }

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{flex: 1}}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
        <ChatContainer
          style={{
            ...config?.chatRoomStyles,
          }}>
          {!config?.disableHeader && (
            <ChatHeader
              currentRoom={roomsList[activeRoomJID]}
              handleBackClick={handleBackClick}
            />
          )}
          {loading || globalLoading ? (
            <Loader color={config?.colors?.primary} />
          ) : Object.keys(roomsList).length < 1 || !activeRoomJID ? (
            <NoSelectedChatIcon />
          ) : roomsList[activeRoomJID]?.messages &&
            roomsList[activeRoomJID]?.messages.length < 1 ? (
            <NoMessagesPlaceholder />
          ) : (
            <MessageList
              flatListRef={flatListRef}
              loadMoreMessages={loadMoreMessages}
              CustomMessage={CustomMessageComponent}
              user={user}
              roomJID={activeRoomJID}
              config={config}
              loading={isLoadingMore}
              isReply={false}
            />
          )}
          {editAction.isEdit && (
            <EditWrapper text={editAction.text || ''} onClose={onCloseEdit} />
          )}
          <SendInput
            editMessage={editAction.text}
            sendMessage={sendMessage}
            sendMedia={sendMedia}
            config={config}
            isLoading={loading}
          />
        </ChatContainer>
      </KeyboardAvoidingView>
    );
  },
);

export default ChatRoom;
