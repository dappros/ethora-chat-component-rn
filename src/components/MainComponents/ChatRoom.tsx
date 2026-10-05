/** @format */

import { isJoiningRoom } from '../../helpers/joiningRoom';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChatContainer, NonRoomChat } from '../styled/StyledComponents';
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { RootState } from '../../roomStore';
import MessageList from './MessageList';
import SendInput from '../styled/SendInput';
import {
  clearReadBoundary,
  clearVisibleRoom,
  deleteRoomMessage,
  setEditAction,
  setLastViewedTimestamp,
  setReadBoundary,
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
import { getChatBackgroundColor } from '../../helpers/getChatBackground';
import { ChooseChatMessage } from './ChooseChatMessage';
import { useRoomUrl } from '../../hooks/useRoomUrl';
import { useSendMessage } from '../../hooks/useSendMessage';
import { IConfig } from '../../types/models/config.model';
import type { IMessage } from '../../types/types';
import { useRoomInitialization } from '../../hooks/useRoomInitialization';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useTheme } from '../../hooks/useTheme';
import { isOwnMessage } from '../../helpers/isOwnMessage';
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
import { KeyboardInputDock } from './KeyboardInputDock';
import useComposing from '../../hooks/useComposing';
import { store } from '../../roomStore';
import {
  getFlushBoundaryTs,
  getReadMarkerTimestamp,
} from '../../helpers/getServerReadTimestamp';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getInputDockPaddingBottom,
  getKeyboardVerticalOffset,
  getKeyboardAvoidingOffset,
  getInputDockKeyboardPadding,
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

const EMPTY_MESSAGES: IMessage[] = [];

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
    const theme = useTheme();

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

    const reduxStore = useStore<RootState>();
    const activeRoomJID = useSelector(
      (state: RootState) => state.rooms.activeRoomJID,
    );
    const activeRoom = useSelector((state: RootState) =>
      activeRoomJID ? state.rooms.rooms?.[activeRoomJID] : undefined,
    );
    const hasRooms = useSelector(
      (state: RootState) => Object.keys(state.rooms.rooms || {}).length > 0,
    );
    const editAction = useSelector((state: RootState) => state.rooms.editAction);
    const globalLoading = useSelector(
      (state: RootState) => state.rooms.isLoading,
    );
    const joiningRoomJID = useSelector(
      (state: RootState) => state.rooms.joiningRoomJID,
    );
    const loading = !!activeRoom?.isLoading;
    const roomMessages = activeRoom?.messages || EMPTY_MESSAGES;
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
        const room = reduxStore.getState().rooms.rooms?.[chatJID];
        if (isLoadingMore || room?.historyComplete) {return;}
        const lastMsgId =
          typeof idOfMessageBefore !== 'string'
            ? idOfMessageBefore
            : Number(room?.messages?.[(room?.messages?.length || 0) - 2]?.id);
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
      [client?.client?.jid, isLoadingMore, reduxStore],
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
    // by MessageList via onReadBoundaryChange, and mirrored into redux
    // (`rooms.readBoundaries`) rather than kept only in a local ref - it
    // is the single source of truth every "leaving this room" path
    // consults (xmppProvider's AppState background handler, its
    // `isVisible=false` handler, the live `advance()` effect, and
    // `useChatRoomFocus`'s `leaveRoom`), not just this component's own
    // unmount cleanup below. Without a boundary, leaving a room (or
    // backgrounding) while scrolled up stamped `now()` (bug #33) or,
    // after the #38 fix, the newest acked message regardless of scroll
    // position (bug #42) - both silently discard genuinely-unread
    // messages.
    //
    // MessageList reports the boundary from onScroll, which fires on
    // every frame of a drag (the "back at the bottom" branch re-reports
    // `null` each time). Mirror only actual CHANGES into redux: an
    // unconditional dispatch per scroll frame would run the whole
    // middleware chain and, worse, reset persistenceMiddleware's 200 ms
    // debounce on every frame, starving the persisted write for as long
    // as the user keeps scrolling.
    const lastBoundarySentRef = useRef<number | null>(null);
    const handleReadBoundaryChange = useCallback((boundaryTs: number | null) => {
      if (!activeRoomJID) {
        return;
      }
      const next = boundaryTs && boundaryTs > 0 ? boundaryTs : null;
      if (lastBoundarySentRef.current === next) {
        return;
      }
      lastBoundarySentRef.current = next;
      dispatch(setReadBoundary({ jid: activeRoomJID, ts: next }));
    }, [activeRoomJID, dispatch]);

    useEffect(() => {
      if (!activeRoomJID) {
        return;
      }

      lastBoundarySentRef.current = null;
      dispatch(setReadBoundary({ jid: activeRoomJID, ts: null }));
      dispatch(setVisibleRoom({ roomJID: activeRoomJID }));
      setIsLoadingMore(false);
      return () => {
        const state = store.getState();
        const rooms = state.rooms?.rooms;
        const heapState = state.roomHeapSlice;
        const boundaryTs = state.rooms?.readBoundaries?.[activeRoomJID] ?? null;
        // getReadMarkerTimestamp honours the boundary (the newest message
        // the user actually reached) when one is set, and otherwise falls
        // back to the newest server-acked message - never the device
        // clock: a fast device clock would write a future marker that the
        // forward-only private-store merge could never correct (bug #38).
        const timestamp = getReadMarkerTimestamp(
          rooms?.[activeRoomJID],
          heapState,
          boundaryTs,
        );
        if (timestamp > 0) {
          dispatch(
            setLastViewedTimestamp({
              chatJID: activeRoomJID,
              timestamp,
            }),
          );
        }
        dispatch(clearVisibleRoom());
        const liveClient = clientRef.current;
        if (liveClient) {
          liveClient
            .flushLastViewedToPrivateStoreStanza(rooms, {
              visibleRoomJID: activeRoomJID,
              // Carry the same boundary to the SERVER marker. Without
              // this the flush defaults to "everything" for the visible
              // room, so messages the user never scrolled down to come
              // back as read on the next login - the local count was
              // right but the server overrode it.
              // Clamped through the same helper as the local stamp -
              // an unclamped boundary would bypass the newest-acked
              // ceiling on the one path where a bad value is permanent
              // (the private-store merge is forward-only, bug #38).
              visibleRoomTs: getFlushBoundaryTs(
                rooms?.[activeRoomJID],
                heapState,
                boundaryTs,
              ),
            })
            .catch(() => {});
        }
        dispatch(deleteRoomMessage({ roomJID: activeRoomJID, messageId: 'delimiter-new' }));
        // The room is genuinely being left (unmount, or activeRoomJID
        // changed to a different room) - release the boundary now that
        // it's been consumed, so a stale value can't leak into the next
        // time this room becomes visible.
        dispatch(clearReadBoundary({ jid: activeRoomJID }));
        lastBoundarySentRef.current = null;
        setIsLoadingMore(false);
      };
    }, [activeRoomJID, dispatch]);

    // hooks useEffects
    // useRoomUrl(activeRoomJID || "", roomsList, config);

    useRoomInitialization(
      activeRoomJID || '',
      (configWithEventHandlers || storeConfig || {}) as IConfig,
    );

    // A join for the requested room is still in flight: the server registers
    // the membership a moment after our presence, so say "joining" with a
    // loader instead of the "choose a chat" placeholder (or the empty-list
    // new-chat screen). Bounded: useRoomInitialization clears the flag when
    // the join and the room-list refresh settle, even if the room never shows.
    if (isJoiningRoom(
        activeRoomJID,
        activeRoom && activeRoomJID ? { [activeRoomJID]: true } : undefined,
        joiningRoomJID
      )) {
      return (
        <View
          testID="chat-room-joining-loader"
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Loader color={configWithEventHandlers?.colors?.primary} />
        </View>
      );
    }

    if (!hasRooms && !loading && !globalLoading) {
      return (
        <NonRoomChat>
          {/* <Text>No room. Let's create one!</Text> */}
          <NewChatModal />
        </NonRoomChat>
      );
    }

    if (!activeRoomJID || !activeRoom) {
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
      configuredPadding: configWithEventHandlers?.inputDockPaddingBottom,
      hostOwnsLayout: !!configWithEventHandlers?.disableKeyboardAvoidingView,
    });
    const keyboardAvoidingOffset = getKeyboardAvoidingOffset({
      configuredOffset: configWithEventHandlers?.keyboardVerticalOffset ?? 0,
    });
    const inputDockKeyboardPadding = getInputDockKeyboardPadding({
      platform: Platform.OS,
      inputDockPaddingBottom,
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
          // The dock's colour: the keyboard-height padding below the dock is
          // this view's own box, and it shows around the keyboard's rounded
          // top corners — it must read as a continuation of the dock.
          style: { flex: 1, backgroundColor: theme.surface },
          behavior: 'padding' as const,
          keyboardVerticalOffset: keyboardAvoidingOffset,
        }
      : { style: { flex: 1 } };
    // Input dock: a plain View normally; under the sticky strategy it becomes
    // a KeyboardStickyView so it (and only it) lifts with the keyboard.
    // Under the avoiding-view strategy the dock's safe-area padding collapses
    // while the keyboard is open (KeyboardInputDock), so the composer is glued
    // to the keyboard.
    const collapsingDock =
      avoidKeyboard && inputDockKeyboardPadding !== inputDockPaddingBottom;
    const InputDockTag: React.ComponentType<any> = stickyInput
      ? KeyboardStickyView
      : collapsingDock
        ? KeyboardInputDock
        : View;
    const inputDockProps: any = {
      // The dock carries the composer's white surface all the way to the
      // bottom edge, so it needs the same rounded top and upward shadow —
      // a square white block behind a rounded composer just hid the corners.
      style: {
        paddingBottom: inputDockPaddingBottom,
        backgroundColor: theme.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        shadowColor: theme.shadow,
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 8,
      },
      ...(stickyInput
        ? { offset: { closed: 0, opened: keyboardVerticalOffset } }
        : {}),
      ...(collapsingDock
        ? {
            closedPadding: inputDockPaddingBottom,
            openedPadding: inputDockKeyboardPadding,
          }
        : {}),
    };

    return (
      <KeyboardWrapper {...keyboardWrapperProps}>
        <ChatContainer
          // The conversation's own colour, not white: the header's rounded
          // bottom corners and the composer's rounded top corners reveal
          // THIS view, so a white parent made both look square.
          style={[
            { backgroundColor: getChatBackgroundColor(configWithEventHandlers) },
            configWithEventHandlers?.chatRoomStyles as
              | import('react-native').ViewStyle
              | undefined,
          ]}
        >
          {!configWithEventHandlers?.disableHeader && (
            <ChatHeader
              currentRoom={activeRoom}
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
            ) : !hasRooms || !activeRoomJID ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <EmptyChatIllustration
                  color={getIconColor(configWithEventHandlers)}
                  panelColor={theme.dark ? theme.surfaceSecondary : undefined}
                />
              </View>
            ) : !roomMessages || roomMessages.length === 0 ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  // Empty rooms used to flip to white, which broke the
                  // header's rounded corners in exactly the same way.
                  backgroundColor: getChatBackgroundColor(
                    configWithEventHandlers
                  ),
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
                      isUser={isOwnMessage(decorated.message, user)}
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
                  activeRoom?.composing ? (
                    configWithEventHandlers?.customTypingIndicator
                      ?.customComponent ? (
                      <configWithEventHandlers.customTypingIndicator.customComponent
                        usersTyping={
                          activeRoom?.composingList || []
                        }
                        text={
                          typeof configWithEventHandlers.customTypingIndicator
                            .text === 'function'
                            ? configWithEventHandlers.customTypingIndicator.text(
                                activeRoom?.composingList || [],
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
            activeRoom?.composing && (
              <CustomTypingIndicator
                usersTyping={
                  activeRoom?.composingList || ['User']
                }
                text={configWithEventHandlers.customTypingIndicator.text}
                position={
                  configWithEventHandlers.customTypingIndicator.position
                }
                styles={configWithEventHandlers.customTypingIndicator.styles}
                customComponent={
                  configWithEventHandlers.customTypingIndicator.customComponent
                }
                isVisible={activeRoom?.composing || false}
              />
            )}
        </ChatContainer>
      </KeyboardWrapper>
    );
  },
);

export default ChatRoom;
