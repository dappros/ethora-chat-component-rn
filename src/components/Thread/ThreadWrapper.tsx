import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { IMessage, User } from '../../types/types';
import type { RootState } from '../../roomStore';
import SendInput from '../styled/SendInput';
import { useXmppClient } from '../../context/xmppProvider';
import MessageList from '../MainComponents/MessageList';
import ModalHeaderComponent from '../Modals/ModalHeaderComponent';
import { setCloseActiveMessage, setEditAction } from '../../roomStore/roomsSlice';
import { EditWrapper } from '../MainComponents/EditWrapper';
import { useSendMessage } from '../../hooks/useSendMessage';
import { createMainMessageForThread } from '../../helpers/createMainMessageForThread';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useTheme } from '../../hooks/useTheme';
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';
import { KeyboardInputDock } from '../MainComponents/KeyboardInputDock';
import {
  getInputDockKeyboardPadding,
  getInputDockPaddingBottom,
} from '../../helpers/keyboardLayout';
import {
  COMPLETE_DISTANCE,
  COMPLETE_VELOCITY,
  EDGE_WIDTH,
  POP,
  PUSH,
} from '../MainComponents/RoomStack';

interface ThreadWrapperProps {
  activeMessage: IMessage;
  user: User;
  customMessageComponent?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
  }>;
}

/**
 * The thread of one message, over the room: slides in from the right,
 * closes with the header's back button, Android back or a swipe from the
 * left edge (same feel as leaving a room). Replies go to the thread;
 * "Also send to <room>" posts them in the channel too.
 */
const ThreadWrapper: FC<ThreadWrapperProps> = ({
  activeMessage,
  user,
  customMessageComponent: CustomMessageComponent,
}) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const { config } = useChatSettingState();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const roomJid = activeMessage.roomJid;

  const room = useSelector((state: RootState) => state.rooms.rooms?.[roomJid]);
  const editAction = useSelector((state: RootState) => state.rooms.editAction);
  const {
    sendMessage: sendMs,
    sendMedia: sendMessageMedia,
    sendEditMessage,
    isLastMessageFromUserAndProcessing,
  } = useSendMessage();

  // `name` is often the room's JID local part (an id) — the title is the
  // human name.
  // Same field the room header and the list show (`name` can be the id).
  const roomDisplayName = String(room?.title || room?.name || 'chat').trim();

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  // 0 = in place, windowWidth = off-screen to the right.
  const x = useRef(new Animated.Value(windowWidth)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(x, { toValue: 0, ...PUSH, useNativeDriver: true }).start();
  }, [x]);

  const close = useCallback(() => {
    if (closing.current) {return;}
    closing.current = true;
    Keyboard.dismiss();
    Animated.timing(x, { toValue: windowWidth, ...POP, useNativeDriver: true }).start(
      () => {
        dispatch(setCloseActiveMessage({ chatJID: roomJid }));
        dispatch(setEditAction({ isEdit: false }));
      }
    );
  }, [dispatch, roomJid, windowWidth, x]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const swipeBack = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .hitSlop({ left: 0, width: EDGE_WIDTH })
        .activeOffsetX(12)
        .failOffsetY([-16, 16])
        .onStart(() => Keyboard.dismiss())
        .onUpdate((e) => {
          if (!closing.current) {x.setValue(Math.max(0, e.translationX));}
        })
        .onEnd((e) => {
          if (closing.current) {return;}
          if (e.translationX > windowWidth * COMPLETE_DISTANCE || e.velocityX > COMPLETE_VELOCITY) {
            close();
          } else {
            Animated.timing(x, { toValue: 0, ...POP, useNativeDriver: true }).start();
          }
        }),
    [close, windowWidth, x]
  );

  // Thread history IS the room's history (replies live in the room).
  const loadMoreMessages = useCallback(
    async (chatJID: string, max: number, idOfMessageBefore?: number) => {
      if (isLoadingMore) {return;}
      if (reduxStore.getState().rooms.rooms?.[chatJID]?.historyComplete) {return;}
      setIsLoadingMore(true);
      try {
        await client?.getHistoryStanza(chatJID, max, idOfMessageBefore);
      } catch (err) {
        console.warn('getHistoryStanza failed', err);
      } finally {
        setIsLoadingMore(false);
      }
    },
    [client, isLoadingMore, reduxStore]
  );

  const sendMessage = useCallback(
    (message: string) => {
      sendMs(message, roomJid, true, isChecked, createMainMessageForThread(activeMessage));
    },
    [activeMessage, isChecked, roomJid, sendMs]
  );

  const sendMedia = useCallback(
    (data: any, type: string) => {
      sendMessageMedia(
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

  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  const sendStartComposing = useCallback(() => {
    if (config?.disableTypingIndicator) {return;}
    client?.sendTypingRequestStanza(roomJid, fullName, true);
  }, [client, config?.disableTypingIndicator, fullName, roomJid]);
  const sendEndComposing = useCallback(() => {
    if (config?.disableTypingIndicator) {return;}
    client?.sendTypingRequestStanza(roomJid, fullName, false);
  }, [client, config?.disableTypingIndicator, fullName, roomJid]);

  const dockPadding = getInputDockPaddingBottom({
    platform: Platform.OS,
    bottomInset: insets.bottom,
    configuredPadding: config?.inputDockPaddingBottom,
  });
  const dockKeyboardPadding = getInputDockKeyboardPadding({
    platform: Platform.OS,
    inputDockPaddingBottom: dockPadding,
  });
  const DockTag: React.ComponentType<any> =
    dockKeyboardPadding !== dockPadding ? KeyboardInputDock : View;

  return (
    <GestureDetector gesture={swipeBack}>
      <Animated.View
        style={[
          styles.thread,
          { backgroundColor: theme.chatBackground, transform: [{ translateX: x }] },
        ]}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={[styles.fill, { backgroundColor: theme.surface }]}
        >
          <View style={[styles.fill, { backgroundColor: theme.chatBackground }]}>
            <ModalHeaderComponent headerTitle="Thread" handleCloseModal={close} />
            <MessageList
              loadMoreMessages={loadMoreMessages}
              CustomMessage={CustomMessageComponent}
              user={user}
              roomJID={roomJid}
              config={config}
              loading={isLoadingMore}
              activeMessage={activeMessage}
              isReply
            />
          </View>
          <DockTag
            {...(DockTag === View
              ? {}
              : { closedPadding: dockPadding, openedPadding: dockKeyboardPadding })}
            style={[
              styles.dock,
              { backgroundColor: theme.surface, shadowColor: theme.shadow },
              DockTag === View ? { paddingBottom: dockPadding } : null,
            ]}
          >
            <Pressable
              testID="thread-also-send"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              onPress={() => setIsChecked((prev) => !prev)}
              style={styles.also}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: isChecked ? theme.primary : theme.textMuted,
                    backgroundColor: isChecked ? theme.primary : 'transparent',
                  },
                ]}
              >
                {isChecked && (
                  <Text style={[styles.check, { color: theme.textOnPrimary }]}>✓</Text>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.alsoText, { color: theme.textSecondary }]}
              >
                Also send to{' '}
                <Text style={{ color: theme.primary, fontWeight: '600' }}>
                  {roomDisplayName}
                </Text>
              </Text>
            </Pressable>
            {editAction?.isEdit && (
              <EditWrapper
                text={editAction.text || ''}
                onClose={() => dispatch(setEditAction({ isEdit: false }))}
              />
            )}
            <SendInput
              editMessage={editAction && editAction.text}
              sendMedia={sendMedia}
              sendMessage={editAction?.isEdit ? sendEditMessage : sendMessage}
              config={config}
              onFocus={sendStartComposing}
              onBlur={sendEndComposing}
              isLoading={!!room?.isLoading}
              isMessageProcessing={isLastMessageFromUserAndProcessing(roomJid)}
            />
          </DockTag>
        </KeyboardAvoidingView>

        {config?.customTypingIndicator?.enabled &&
          (config.customTypingIndicator.position === 'overlay' ||
            config.customTypingIndicator.position === 'floating') &&
          room?.composing && (
            <CustomTypingIndicator
              usersTyping={room?.composingList || ['User']}
              text={config.customTypingIndicator.text}
              position={config.customTypingIndicator.position}
              styles={config.customTypingIndicator.styles}
              customComponent={config.customTypingIndicator.customComponent}
              isVisible={!!room?.composing}
            />
          )}
      </Animated.View>
    </GestureDetector>
  );
};

export default ThreadWrapper;

const styles = StyleSheet.create({
  thread: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  fill: {
    flex: 1,
  },
  dock: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  },
  also: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  alsoText: {
    fontSize: 14,
  },
});
