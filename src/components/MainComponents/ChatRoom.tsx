/** @format */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChatContainer, NonRoomChat } from '../styled/StyledComponents';
import { useDispatch } from 'react-redux';
import MessageList from './MessageList';
import SendInput from '../styled/SendInput';
import {
  clearVisibleRoom,
  deleteRoomMessage,
  setEditAction,
  setLastViewedTimestamp,
  setVisibleRoom,
} from '../../roomStore/roomsSlice';
import Loader from '../styled/Loader';
import { useXmppClient } from '../../context/xmppProvider';
import ChatHeader from './ChatHeader';
import NoMessagesPlaceholder from './NoMessagesPlaceholder';
import NewChatModal from '../Modals/NewChatModal/NewChatModal';
import { EditWrapper } from './EditWrapper';
import { EmptyChatIllustration } from '../../assets/EmptyChatIllustration';
import { getIconColor } from '../../helpers/getIconColor';
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
  AppState,
  AppStateStatus,
  Keyboard,
  Platform,
  TouchableWithoutFeedback,
  View,
  KeyboardEvent,
} from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import useComposing from '../../hooks/useComposing';
import { store } from '../../roomStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getInputDockPaddingBottom,
  getKeyboardVerticalOffset,
} from '../../helpers/keyboardLayout';

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
    const insets = useSafeAreaInsets();

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

    // Under the sticky keyboard strategy, the input dock's position is
    // driven by KeyboardStickyView's native-animated offset. If the app
    // is backgrounded while the keyboard-close animation hasn't finished,
    // the OS removes the keyboard from the app-switcher snapshot but the
    // shared value hasn't caught up to "closed" yet, so the input appears
    // to float in that preview.
    //
    // NOTE on what this does and doesn't fix: iOS actually captures that
    // preview during the active→inactive transition, BEFORE 'background'
    // fires — so dismissing here on 'background' lands too late to affect
    // the snapshot already taken, and is effectively a no-op for the exact
    // iOS symptom in bug #37. An earlier version keyed this off 'inactive'
    // instead, which does land in time, but 'inactive' also fires for
    // Control Center, share sheets, and permission prompts — none of which
    // should close the user's keyboard — so that traded a rare cosmetic
    // preview glitch for a much more common false dismissal. Kept on
    // 'background': it still resets the offset for genuine backgrounding
    // (home button, app switch) and for Android's recents preview (RN's
    // AppState has no 'inactive' there), at the cost of leaving the iOS
    // switcher-preview glitch itself unresolved. Both symptoms are cosmetic
    // per the QA report, which explicitly accepted leaving this imperfect
    // rather than risk destabilizing the sticky strategy. Sticky-only;
    // doesn't touch the other keyboard strategies.
    const stickyInputEnabled =
      !configWithEventHandlers?.disableKeyboardAvoidingView &&
      !!configWithEventHandlers?.keyboardStickyInput;
    useEffect(() => {
      if (!stickyInputEnabled) {
        return;
      }
      const onAppStateChange = (nextState: AppStateStatus) => {
        if (nextState === 'background') {
          Keyboard.dismiss();
        }
      };
      const subscription = AppState.addEventListener('change', onAppStateChange);
      return () => subscription.remove();
    }, [stickyInputEnabled]);

    const sendMessage = useCallback(
      (message: string) => {
        if (!activeRoomJID) {
          return;
        }
        sendMs(message, activeRoomJID);
      },
      [activeRoomJID, sendMs]
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

    // Read the latest client through a ref so this effect's setup phase
    // does NOT re-run on every `client` identity change. With `client` in
    // the deps array, a reconnect or any provider re-render would re-fire
    // setup → `dispatch(setVisibleRoom(...))` ~one tick after the host
    // cleared visibility via the `isVisible` prop (XmppProvider) — racing
    // and clobbering it, so `useUnread()` reported 0 in tab-mounted hosts.
    // Customer-reported #19. The cleanup still needs the live client for
    // flushLastViewedToPrivateStoreStanza, which is what the ref provides.
    const clientRef = useRef(client);
    useEffect(() => {
      clientRef.current = client;
    }, [client]);

    // Tracks what the user actually saw: `null` while they're at the
    // bottom (safe to mark everything read), or the timestamp of the
    // newest message visible when they scrolled away from it. Reported
    // by MessageList via onReadBoundaryChange. Without this, leaving a
    // room (or backgrounding) while scrolled up stamped `now()` as read
    // and silently discarded genuinely-unread messages. Customer-
    // reported #33.
    const readBoundaryRef = useRef<number | null>(null);
    const handleReadBoundaryChange = useCallback((boundaryTs: number | null) => {
      readBoundaryRef.current = boundaryTs;
    }, []);

    useEffect(() => {
      if (!activeRoomJID) {
        return;
      }

      readBoundaryRef.current = null;
      dispatch(setVisibleRoom({ roomJID: activeRoomJID }));
      setIsLoadingMore(false);
      return () => {
        const timestamp = readBoundaryRef.current ?? new Date().getTime();
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID,
            timestamp,
          }),
        );
        dispatch(clearVisibleRoom());
        const liveClient = clientRef.current;
        if (liveClient) {
          liveClient
            .flushLastViewedToPrivateStoreStanza(store.getState().rooms?.rooms, {
              visibleRoomJID: activeRoomJID,
              // Carry the same boundary to the SERVER marker. Without
              // this the flush defaults to Date.now() for the visible
              // room, so messages the user never scrolled down to come
              // back as read on the next login — the local count was
              // right but the server overrode it.
              visibleRoomTs: readBoundaryRef.current,
            })
            .catch(() => {});
        }
        dispatch(deleteRoomMessage({ roomJID: activeRoomJID, messageId: 'delimiter-new' }));
        setIsLoadingMore(false);
      };
    }, [activeRoomJID, dispatch]);

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

    const keyboardVerticalOffset = getKeyboardVerticalOffset({
      platform: Platform.OS,
      configuredOffset: configWithEventHandlers?.keyboardVerticalOffset ?? 0,
      bottomInset: insets.bottom,
    });
    const inputDockPaddingBottom = getInputDockPaddingBottom({
      platform: Platform.OS,
      bottomInset: insets.bottom,
    });

    // Keyboard avoidance is delegated to react-native-keyboard-controller's
    // KeyboardAvoidingView. When the HOST app supplies its own keyboard
    // handling (its own KeyboardProvider + KeyboardAvoidingView around
    // <Chat>), this built-in one becomes a SECOND avoider wrapping the same
    // tree; two of them both animating padding on keyboard open is the
    // Android flicker reported in bug #6. `disableKeyboardAvoidingView`
    // swaps this wrapper for a plain View so the host owns it outright
    // (ReduxWrapper drops the built-in KeyboardProvider under the same flag).
    //
    // Bug #6 history (built-in path):
    //  - Original: behavior="height" on Android — flicker, because
    //    Android's adjustResize already shrinks the window; KAV resizing
    //    on top double-resized every keyboard open.
    //  - 26.5.6: behavior={undefined} on Android — input got completely
    //    blocked when a host disables adjustResize via softInputMode.
    //  - 26.5.8: behavior="padding" on BOTH platforms — input lifted above
    //    the keyboard regardless of the host's softInputMode.
    // Three keyboard strategies (default = avoidingView, behaviour unchanged):
    //  • none  ('disableKeyboardAvoidingView'): plain View — the host owns
    //    the keyboard entirely (ReduxWrapper also drops the KeyboardProvider).
    //  • sticky('keyboardStickyInput'): plain View outer + ONLY the input
    //    dock wrapped in <KeyboardStickyView>, so just the input tracks the
    //    keyboard and the message list is never resized/reflowed — avoids the
    //    Android "messages jump/flash" the padding KAV causes. Best for
    //    edge-to-edge hosts (the OS doesn't also resize the window).
    //  • avoidingView (default): keyboard-controller KAV, behavior="padding".
    const noKeyboardHandling =
      !!configWithEventHandlers?.disableKeyboardAvoidingView;
    const stickyInput =
      !noKeyboardHandling && !!configWithEventHandlers?.keyboardStickyInput;
    const avoidKeyboard = !noKeyboardHandling && !stickyInput;
    const KeyboardWrapper: React.ComponentType<any> = avoidKeyboard
      ? KeyboardAvoidingView
      : View;
    const keyboardWrapperProps = avoidKeyboard
      ? {
          style: { flex: 1 },
          behavior: 'padding' as const,
          keyboardVerticalOffset,
        }
      : { style: { flex: 1 } };
    // Input dock: a plain View normally; under the sticky strategy it becomes
    // a KeyboardStickyView so it (and only it) lifts with the keyboard.
    const InputDockTag: React.ComponentType<any> = stickyInput
      ? KeyboardStickyView
      : View;
    const inputDockProps: any = {
      style: { paddingBottom: inputDockPaddingBottom, backgroundColor: '#fff' },
      ...(stickyInput
        ? { offset: { closed: 0, opened: keyboardVerticalOffset } }
        : {}),
    };

    return (
      <KeyboardWrapper {...keyboardWrapperProps}>
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
                <EmptyChatIllustration
                  color={getIconColor(configWithEventHandlers)}
                />
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
                onReadBoundaryChange={handleReadBoundaryChange}
              />
            )}
          </View>
          {editAction && editAction.isEdit && (
            <EditWrapper text={editAction.text || ''} onClose={onCloseEdit} />
          )}
          <InputDockTag {...inputDockProps}>
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
          </InputDockTag>

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
      </KeyboardWrapper>
    );
  },
);

export default ChatRoom;
