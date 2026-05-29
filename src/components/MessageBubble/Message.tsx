import React, { useRef, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  findNodeHandle,
  UIManager,
  Dimensions,
  Text,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { Avatar } from './Avatar';
import MessageInteractions from './MessageInteractions';
import { BottomReplyContainer } from './BottomReplyContainer';
import { MessageReply } from './MessageReply';
import { DeletedMessage } from './DeletedMessage';
import {
  setActiveModal,
  setDeleteModal,
  setSelectedUser,
} from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { setActiveMessage, setEditAction } from '../../roomStore/roomsSlice';
import styled from 'styled-components/native';
import { IUser, MessageProps } from '../../types/types';
import MediaMessage from '../MainComponents/MediaMessage';
import MessageTranslations from './MessageTranslations';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { parseMessageBody } from '../../helpers/parseMessageBody';
import { useMessageHeapState } from '../../hooks/useMessageHeapState';
import { DoubleTick } from '../../assets/icons';
import { useXmppClient } from '../../context/xmppProvider';
import { useSendMessage } from '../../hooks/useSendMessage';
import { MessageReaction } from './MessageReaction';
import { MessageFooter } from '../styled/StyledComponents';

const CustomMessageContainer = styled.View<{ isUser: boolean; reply?: number }>`
  flex-direction: row;
  padding: 10px;
  align-items: flex-end;
  justify-content: ${({ isUser }) => (isUser ? 'flex-end' : 'flex-start')};
  margin-bottom: ${(props) => (props.reply ? '20px' : '0px')};
`;

const CustomMessageBubble = styled.View<{
  isUser: boolean;
  deleted?: boolean;
  backgroundMessageUser?: string;
  backgroundMessage?: string;
  isMedia?: boolean;
}>`
  position: relative;
  max-width: 85%;
  min-width: ${({ isMedia }) => (isMedia ? '0' : '30%')};
  align-items: ${({ isMedia, isUser }) =>
    isMedia ? (isUser ? 'flex-end' : 'flex-start') : 'stretch'};
  padding: ${({isMedia}) => isMedia ? '0' : '10'}px;
  padding-bottom: ${({isMedia}) => isMedia ? '6' : '10'}px;
  margin-right: ${({isUser}) => isUser ? '0' : '10px'};
  margin-left: ${({isUser}) => isUser ? '10px' : '0'};
  border-radius: 10px;
  overflow: hidden;
  border-bottom-left-radius: ${({ isUser }) => (isUser ? '10' : '0')}px;
  border-bottom-right-radius: ${({ isUser }) => (isUser ? '0' : '10')}px;
  background-color: ${({
    isUser,
    deleted,
    backgroundMessageUser,
    backgroundMessage,
  }) =>
    deleted
      ? '#f5f5f5'
      : isUser
      ? backgroundMessageUser || '#d1e7ff'
      : backgroundMessage || '#fff'};
`;

const CustomMessageText = styled.Text<{
  isUser: boolean;
  colorUser?: string;
  color?: string;
}>`
  font-size: 16px;
  color: ${({ color, colorUser, isUser }) =>
    isUser ? colorUser || '#333' : color || '#333'};
`;

const CustomMessagePhoto = styled.Image`
  width: 40px;
  height: 40px;
  border-radius: 20px;
`;

const CustomMessagePhotoContainer = styled.TouchableOpacity`
  margin-right: 10px;
`;

const CustomUserName = styled.Text<{ color?: string; media: boolean }>`
  font-size: 14px;
  font-weight: 500;
  padding-bottom: 8px;
  padding-left: ${({media}) => media ? '16px': 0};
  padding-top: ${({media}) => media ? '8px': 0};
  color: ${({ color }) => color || '#333'};
`;

const CustomMessageTimestamp = styled.Text<{
  isUser?: boolean;
  color?: string;
  colorUser?: string;
}>`
  font-size: 12px;
  color: #999;
  color: ${({ isUser, color, colorUser }) =>
    isUser ? colorUser || '#999' : color || '#999'};
  margin-top: 5px;
  align-self: flex-end;
`;

const Message: React.FC<MessageProps> = ({ message, isUser, isReply }) => {
  const dispatch = useDispatch();
  const { client } = useXmppClient();
  const { config, langSource, user} = useChatSettingState();
  const { idSet, failedIdSet } = useMessageHeapState();
  const { retryMessage } = useSendMessage();

  const [isPressed, setIsPressed] = useState(false);

  if (__DEV__ && message.id && !(globalThis as any).__loggedMsg?.[message.id]) {
    ((globalThis as any).__loggedMsg ||= {})[message.id] = true;
  }

  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const messageRef = useRef<View>(null);

  const handleUserAvatarClick = (user: IUser): void => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    dispatch(setSelectedUser(user));
  };

  const handleReplyMessage = () => {
    dispatch(setEditAction({ isEdit: false }));

    if (!isReply && message.mainMessage) {
      const messageCore = JSON.parse(message.mainMessage);
      dispatch(
        setActiveMessage({ id: messageCore.id, chatJID: messageCore.roomJid })
      );

      return setIsPressed(false);
    }

    dispatch(setActiveMessage({ id: message.id, chatJID: message.roomJid }));

    return setIsPressed(false);
  };

  const handleDeleteMessage = () => {
    dispatch(
      setDeleteModal({
        isDeleteModal: true,
        roomJid: message.roomJid,
        messageId: message.id,
      })
    );
    setIsPressed(false);
  };

  const handleEditMessage = () => {
    dispatch(
      setEditAction({
        isEdit: true,
        roomJid: message.roomJid,
        messageId: message.id,
        text: message.body,
      })
    );

    return setIsPressed(false);
  };

  // const handleLongPress = () => {
  //   setIsPressed(true);
  //   console.log("setIsPressed", isPressed);
  // };

  const handleReactionMessage = (emoji: string) => {
    if (!message.reaction) {
      return client?.sendMessageReactionStanza(
        message.id,
        message.roomJid,
        [emoji],
        `${user.firstName} ${user.lastName}` as any
      );
    }
    if (
      message.reaction &&
      message.reaction[user.xmppUsername || ''] &&
      message.reaction[user.xmppUsername || '']?.emoji.includes(emoji)
    ) {
      const filterEmoji = message.reaction[user.xmppUsername || '']?.emoji.filter(
        (reaction: any) => reaction !== emoji
      );

      return client?.sendMessageReactionStanza(
        message.id,
        message.roomJid,
        filterEmoji,
        `${user.firstName} ${user.lastName}` as any
      );
    }

    client?.sendMessageReactionStanza(
      message.id,
      message.roomJid,
      [...(message.reaction[user.xmppUsername || '']?.emoji || []), emoji],
      `${user.firstName} ${user.lastName}` as any
    );
  };

  const handleLongPress = () => {
    if (messageRef.current) {
      const nodeHandle = findNodeHandle(messageRef.current);
      if (nodeHandle) {
        UIManager.measure(nodeHandle, (_x, _y, _width, height, pageX, pageY) => {
          const screenHeight = Dimensions.get('window').height;
          // Actual MessageInteractions is short — Copy (1 row, ~40px)
          // for non-own messages, Copy+Edit+Delete with dividers
          // (~140px) for own messages. 160 covers the worst case with
          // a tiny safety margin. The previous 280 estimate was for a
          // bigger reactions-strip menu that landed as a separate
          // component — leaving 280 here over-reserved space and made
          // the menu render absurdly high above the bubble.
          const MENU_HEIGHT = 160;
          // Treat the consumer-supplied keyboardVerticalOffset as a
          // proxy for tab bar + bottom safe-area when present; falls
          // back to a reasonable default so the menu doesn't bump into
          // the nav bar on phones without one in config.
          const bottomReserve =
            (config?.keyboardVerticalOffset ?? 0) + 24;
          const topReserve = 16;

          const spaceBelow = screenHeight - (pageY + height) - bottomReserve;
          const spaceAbove = pageY - topReserve;

          let menuY: number;
          if (spaceBelow >= MENU_HEIGHT) {
            menuY = pageY + height;
          } else if (spaceAbove >= MENU_HEIGHT) {
            menuY = pageY - MENU_HEIGHT;
          } else {
            // Neither side has room (e.g. very small phone, large
            // menu) — clamp to the visible region so at least the
            // top of the menu is reachable.
            menuY = Math.max(
              topReserve,
              screenHeight - MENU_HEIGHT - bottomReserve
            );
          }

          setContextMenuPosition({ x: pageX, y: menuY });
        });
      }
    }
    setIsPressed(true);
  };

  const messageText = config?.messageTextFilter?.enabled
    ? parseMessageBody(config?.messageTextFilter.filterFunction(message.body))
    : parseMessageBody(message.body);

  const isFailed = failedIdSet.has(message.id);
  const isPending =
    !isFailed && (idSet.has(message.id) || message?.pending || false);

  const onRetryPress = () => {
    if (isFailed) {retryMessage(message.id);}
  };

  return (
    <View>
      {isPressed && <View style={styles.overlay} />}
      <View
        ref={messageRef}
        style={[
          styles.customMessageContainer,
          {
            justifyContent: isUser ? 'flex-end' : 'flex-start',
            marginBottom: !!message?.reply?.length || message?.reaction && !!Object.keys(message?.reaction)?.length
             ? 20 : 0,
          },
          isPressed
            ? { transform: [{ scale: 1.05 }], paddingRight: 16 }
            : undefined,
          // justify-content: ${({ isUser }) => (isUser ? "flex-end" : "flex-start")},
          // margin-bottom: ${(props) => !!props.reply && "20px"},
        ]}
      >
        {!isUser && (
          <CustomMessagePhotoContainer
            onPress={() => handleUserAvatarClick(message.user)}
          >
            {message.user?.profileImage ? (
              <CustomMessagePhoto source={{ uri: message.user.profileImage }} />
            ) : (
              <Avatar username={message.user.name} />
            )}
          </CustomMessagePhotoContainer>
        )}
        <Pressable
          // The Pressable fills the row's content area, so the bubble
          // inside must be aligned to the sender's side — otherwise it
          // hugs the left and own media bubbles sit with a right-side
          // gap (text bubbles only looked right because they're narrow).
          // flex-end for own, flex-start for others.
          style={{
            flex: 1,
            alignItems: isUser ? 'flex-end' : 'flex-start',
          }}
          // disableInteractions hides the long-press → context menu
          // (delete / edit / reply / react). Mirrors web's config gate.
          onLongPress={
            config?.disableInteractions ? undefined : handleLongPress
          }
          delayLongPress={500}
        >
          <CustomMessageBubble
            isUser={isUser}
            deleted={message.isDeleted}
            isMedia={message?.isMediafile === 'true' && !message?.isDeleted}
            backgroundMessageUser={config?.messageColor?.backgroundMessageUser}
            backgroundMessage={config?.messageColor?.backgroundMessage}
          >
            {!isUser && (
              <CustomUserName color={config?.colors?.primary} media={message?.isMediafile === 'true'}>
                {message.user.name}
              </CustomUserName>
            )}
            {!isReply && message.mainMessage && (
              <MessageReply
                handleReplyMessage={handleReplyMessage}
                isUser={isUser}
                text={JSON.parse(message.mainMessage).text}
                color={config?.colors?.primary}
              />
            )}

            {message?.isMediafile === 'true' && !message?.isDeleted ? (
              <MediaMessage
                mimeType={message.mimetype}
                messageText={message.locationPreview}
                location={message?.location}
                message={message}
              />
            ) : (
              <>
                {message.isDeleted && message.id !== 'delimiter-new' ? (
                  <DeletedMessage />
                ) : (
                  <CustomMessageText
                    isUser={isUser}
                    colorUser={config?.messageColor?.colorUser}
                    color={config?.messageColor?.color}
                  >
                    <Text>{messageText}</Text>
                  </CustomMessageText>
                )}
              </>
            )}
            {config?.enableTranslates && (
              <MessageTranslations
                message={message}
                config={config}
                langSource={langSource}
              />
            )}
            <View style={styles.timestampRow}>
            {!config?.disableSentLogic && isUser && isPending && (
              <Text style={styles.timestampText}>sending...</Text>
            )}
            {!config?.disableSentLogic && isUser && isFailed && (
              <Text
                onPress={onRetryPress}
                style={styles.failedText}
                accessibilityRole="button"
                accessibilityLabel="Retry sending message"
              >
                ! Failed — tap to retry
              </Text>
            )}
            <Text style={styles.timestampText}>
              {new Date(message.date).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
            {!config?.disableSentLogic && isUser && !isPending && !isFailed && (
              <DoubleTick />
            )}
          </View>

          {message?.reply?.length && message?.reply?.length > 0 ? (
              <BottomReplyContainer
                isUser={isUser}
                onClick={handleReplyMessage}
                reply={message?.reply}
              />
            ) : (
              <View />
            )}

          <MessageFooter isUser={isUser}>

            {message.reaction && !config?.disableReactions && (
              <MessageReaction
                reaction={message.reaction}
                changeReaction={handleReactionMessage}
                color={config?.colors?.primary || '#0052CD'}
                userName={`${user.firstName} ${user.lastName}`}
              />
            )}
          </MessageFooter>
          </CustomMessageBubble>
        </Pressable>
      </View>
      {!config?.disableInteractions && isPressed && (
        <MessageInteractions
          position={contextMenuPosition}
          isReply={isReply}
          isUser={isUser}
          message={message}
          closeMenu={() => setIsPressed(false)}
          handleReplyMessage={handleReplyMessage}
          handleDeleteMessage={handleDeleteMessage}
          handleEditMessage={handleEditMessage}
          handleReactionMessage={handleReactionMessage}
        />
      )}
    </View>
  );
};

export { Message };

const styles = StyleSheet.create({
  customMessageContainer: {
    flexDirection: 'row',
    padding: 10,
    alignItems: 'flex-end',
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    // backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginTop: 5,
    alignSelf: 'flex-end',
  },
  failedText: {
    color: '#E53935',
    fontWeight: '600',
    marginRight: 6,
  },
  // Row keeps the time text and the DoubleTick SVG on the same line.
  // The time Text gets an explicit lineHeight equal to the 16px tick so
  // both occupy the same-height box; with alignItems center they line up
  // exactly. Without the lineHeight the Text's natural line box was
  // shorter than the icon, so the centred tick floated above the digits.
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  timestampText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#999',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
