/** @format */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChatContainer, NonRoomChat } from '../styled/StyledComponents';
import { useDispatch } from 'react-redux';
import MessageList from './MessageList';
import SendInput from '../styled/SendInput';
import {
  deleteRoomMessage,
  setEditAction,
  setLastViewedTimestamp,
} from '../../roomStore/roomsSlice';
import Loader from '../styled/Loader';
import { useXmppClient } from '../../context/xmppProvider';
import ChatHeader from './ChatHeader';
import NoMessagesPlaceholder from './NoMessagesPlaceholder';
import NewChatModal from '../Modals/NewChatModal/NewChatModal';
import { EditWrapper } from './EditWrapper';
import { NoSelectedChatIcon } from '../../assets/icons';
import { ChooseChatMessage } from './ChooseChatMessage';
import { useRoomUrl } from '../../hooks/useRoomUrl';
import { useSendMessage } from '../../hooks/useSendMessage';
import { IConfig } from '../../types/models/config.model';
import { useRoomInitialization } from '../../hooks/useRoomInitialization';
import { useRoomState } from '../../hooks/useRoomState';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';
// import {PanGestureHandler} from 'react-native-gesture-handler';
import { FlatList } from 'react-native';
import {
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  View,
  KeyboardEvent,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import useComposing from '../../hooks/useComposing';

interface ChatRoomProps {
  CustomMessageComponent?: any;
  CustomInputComponent?: React.ComponentType<any>;
  CustomScrollableArea?: React.ComponentType<any>;
  CustomDaySeparator?: React.ComponentType<any>;
  CustomNewMessageLabel?: React.ComponentType<any>;
  handleBackClick?: (value: boolean) => void;
  eventHandlers?: IConfig['eventHandlers'];
}

const ChatRoom: React.FC<ChatRoomProps> = React.memo(
  ({
    CustomMessageComponent,
    CustomInputComponent,
    CustomScrollableArea,
    CustomDaySeparator,
    CustomNewMessageLabel,
    handleBackClick,
    eventHandlers: propsEventHandlers,
  }) => {
    const { client } = useXmppClient();
    const dispatch = useDispatch();

    const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

    const { user, config: storeConfig } = useChatSettingState();

    // Merge eventHandlers from props with config (props take precedence)
    // This is necessary because functions can't be stored in Redux
    const configWithEventHandlers = React.useMemo(() => {
      if (propsEventHandlers && storeConfig) {
        return {
          ...storeConfig,
          eventHandlers: propsEventHandlers,
        };
      }
      return storeConfig;
    }, [storeConfig, propsEventHandlers]);

    const {
      roomsList,
      activeRoomJID,
      editAction,
      loading,
      globalLoading,
      roomMessages,
    } = useRoomState();
    const {
      sendMessage: sendMs,
      sendMedia: sendMessageMedia,
      sendEditMessage,
      isLastMessageFromUserAndProcessing,
    } = useSendMessage(configWithEventHandlers);
    const { sendStartComposing, sendEndComposing } = useComposing(
      configWithEventHandlers || storeConfig,
    );

    const sendMessage = useCallback(
      (message: string) => {
        if (!activeRoomJID) {
          return;
        }
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID,
            timestamp: 0,
          }),
        );
        sendMs(message, activeRoomJID);
      },
      [activeRoomJID],
    );

    const sendMedia = useCallback(
      (data: any, type: string) => {
        // Return the promise so callers can sequence the follow-up
        // text send AFTER the upload finishes (consumer expectation:
        // media first, text second — never interleaved).
        return sendMessageMedia(data, type, activeRoomJID || '');
      },
      [activeRoomJID],
    );

    const loadMoreMessages = useCallback(
      async (chatJID: string, max: number, idOfMessageBefore?: number) => {
        if (isLoadingMore || roomsList?.[chatJID]?.historyComplete) {return;}
        const lastMsgId =
          typeof idOfMessageBefore !== 'string'
            ? idOfMessageBefore
            : Number(
                roomsList[chatJID].messages[
                  roomsList[chatJID].messages.length - 2
                ]?.id,
              );
        setIsLoadingMore(true);
        try {
          // Return the promise so MessageList's `await loadMoreMessages`
          // actually waits for MAM to respond before its own onEndReached
          // re-arms — otherwise the awaited call resolves with `undefined`
          // immediately and rapid scrolls fire repeat requests that step
          // on each other.
          await client?.getHistoryStanza(chatJID, max, lastMsgId);
        } finally {
          setIsLoadingMore(false);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [client?.client?.jid, isLoadingMore, roomsList],
    );

    const onCloseEdit = () => {
      dispatch(setEditAction({ isEdit: false }));
    };

    useEffect(() => {
      if (!activeRoomJID) {
        return;
      }

      dispatch(
        setLastViewedTimestamp({
          chatJID: activeRoomJID,
          timestamp: 0,
        }),
      );
      setIsLoadingMore(false);
      return () => {
        if (client) {
          client.actionSetTimestampToPrivateStoreStanza(
            activeRoomJID,
            new Date().getTime(),
            Object.keys(roomsList),
          );
        }
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID,
            timestamp: new Date().getTime(),
          }),
        );
        dispatch(
          deleteRoomMessage({
            roomJID: activeRoomJID,
            messageId: 'delimiter-new',
          }),
        );
        setIsLoadingMore(false);
      };
    }, [activeRoomJID]);

    // hooks useEffects
    // useRoomUrl(activeRoomJID || "", roomsList, config);

    useRoomInitialization(
      activeRoomJID || '',
      roomsList,
      (configWithEventHandlers || storeConfig || {}) as IConfig,
      roomMessages.length,
    );

    if (Object.keys(roomsList)?.length < 1 && !loading && !globalLoading) {
      return (
        <NonRoomChat>
          {/* <Text>No room. Let's create one!</Text> */}
          <NewChatModal />
        </NonRoomChat>
      );
    }

    if (!activeRoomJID || !roomsList?.[activeRoomJID]) {
      return <ChooseChatMessage />;
    }

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // Bug #6 history:
        //  - Original code: behavior="height" on Android — caused
        //    flicker because Android's adjustResize already shrinks
        //    the window; KAV resizing on top of that double-resized
        //    every keyboard open.
        //  - 26.5.6 attempt: behavior={undefined} on Android — input
        //    got completely blocked because some host apps disable
        //    adjustResize via the activity's softInputMode.
        //  - 26.5.8 fix: behavior="padding" on BOTH platforms. Padding
        //    adds bottom-padding equal to the keyboard height without
        //    changing the layout's height prop — no double-resize on
        //    Android, no flicker, and the input is always lifted above
        //    the keyboard regardless of the host's softInputMode.
        behavior="padding"
        keyboardVerticalOffset={configWithEventHandlers?.keyboardVerticalOffset ?? 0}
      >
        <ChatContainer
          style={
            configWithEventHandlers?.chatRoomStyles
              ? (configWithEventHandlers.chatRoomStyles as import('react-native').ViewStyle)
              : undefined
          }
        >
          {!configWithEventHandlers?.disableHeader && (
            <ChatHeader
              currentRoom={roomsList[activeRoomJID]}
              handleBackClick={handleBackClick}
            />
          )}
          {configWithEventHandlers?.chatHeaderAdditional?.enabled &&
            configWithEventHandlers.chatHeaderAdditional.element()}
          <View style={{ flex: 1 }}>
            {loading || globalLoading ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Loader color={configWithEventHandlers?.colors?.primary} />
              </View>
            ) : Object.keys(roomsList).length < 1 || !activeRoomJID ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <NoSelectedChatIcon />
              </View>
            ) : !roomMessages || roomMessages.length === 0 ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: '#ffffff',
                }}
              >
                <NoMessagesPlaceholder />
              </View>
            ) : CustomScrollableArea ? (
              <CustomScrollableArea
                roomJID={activeRoomJID}
                messages={roomMessages}
                decoratedMessages={roomMessages.map((msg, idx) => ({
                  message: msg,
                  showDateLabel:
                    idx === 0 ||
                    new Date(msg.date).toDateString() !==
                      new Date(roomMessages[idx - 1]?.date).toDateString(),
                }))}
                isLoading={isLoadingMore}
                isReply={false}
                loadMoreMessages={loadMoreMessages}
                renderMessage={(decorated: {
                  message: any;
                  showDateLabel: boolean;
                }) =>
                  CustomMessageComponent ? (
                    <CustomMessageComponent
                      message={decorated.message}
                      isUser={decorated.message.user.id === user.xmppUsername}
                      isReply={false}
                    />
                  ) : null
                }
                scrollController={{
                  scrollToBottom: () => {},
                  waitForImagesLoaded: async () => {},
                  showScrollButton: false,
                  newMessagesCount: 0,
                  resetNewMessageCounter: () => {},
                }}
                typingIndicator={
                  roomsList[activeRoomJID]?.composing ? (
                    configWithEventHandlers?.customTypingIndicator
                      ?.customComponent ? (
                      <configWithEventHandlers.customTypingIndicator.customComponent
                        usersTyping={
                          roomsList[activeRoomJID]?.composingList || []
                        }
                        text={
                          typeof configWithEventHandlers.customTypingIndicator
                            .text === 'function'
                            ? configWithEventHandlers.customTypingIndicator.text(
                                roomsList[activeRoomJID]?.composingList || [],
                              )
                            : configWithEventHandlers.customTypingIndicator
                                .text || 'Typing...'
                        }
                        isVisible={true}
                      />
                    ) : null
                  ) : undefined
                }
                config={configWithEventHandlers}
              />
            ) : (
              <MessageList
                loadMoreMessages={loadMoreMessages}
                CustomMessage={CustomMessageComponent}
                CustomDaySeparator={CustomDaySeparator}
                CustomNewMessageLabel={CustomNewMessageLabel}
                user={user}
                roomJID={activeRoomJID}
                config={configWithEventHandlers}
                loading={isLoadingMore}
                isReply={false}
              />
            )}
          </View>
          {editAction && editAction.isEdit && (
            <EditWrapper text={editAction.text || ''} onClose={onCloseEdit} />
          )}
          {CustomInputComponent ? (
            <CustomInputComponent
              sendMessage={
                editAction && editAction.isEdit ? sendEditMessage : sendMessage
              }
              sendMedia={sendMedia}
              config={configWithEventHandlers}
              isLoading={loading}
              onFocus={sendStartComposing}
              onBlur={sendEndComposing}
              isMessageProcessing={isLastMessageFromUserAndProcessing(
                activeRoomJID,
              )}
              editMessage={editAction && editAction.text}
            />
          ) : (
            <SendInput
              editMessage={editAction && editAction.text}
              sendMessage={
                editAction && editAction.isEdit ? sendEditMessage : sendMessage
              }
              sendMedia={sendMedia}
              config={configWithEventHandlers}
              isLoading={loading}
              onFocus={sendStartComposing}
              onBlur={sendEndComposing}
              isMessageProcessing={isLastMessageFromUserAndProcessing(
                activeRoomJID,
              )}
            />
          )}

          {configWithEventHandlers?.customTypingIndicator?.enabled &&
            (configWithEventHandlers.customTypingIndicator.position ===
              'overlay' ||
              configWithEventHandlers.customTypingIndicator.position ===
                'floating') &&
            roomsList[activeRoomJID]?.composing && (
              <CustomTypingIndicator
                usersTyping={
                  roomsList[activeRoomJID]?.composingList || ['User']
                }
                text={configWithEventHandlers.customTypingIndicator.text}
                position={
                  configWithEventHandlers.customTypingIndicator.position
                }
                styles={configWithEventHandlers.customTypingIndicator.styles}
                customComponent={
                  configWithEventHandlers.customTypingIndicator.customComponent
                }
                isVisible={roomsList[activeRoomJID]?.composing || false}
              />
            )}
        </ChatContainer>
      </KeyboardAvoidingView>
    );
  },
);

export default ChatRoom;
