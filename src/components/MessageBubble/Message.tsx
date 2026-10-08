import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Alert,
  View,
  Pressable,
  StyleSheet,
  findNodeHandle,
  UIManager,
  Text,
  Keyboard,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { Avatar } from './Avatar';
import { BubbleHighlight } from './BubbleHighlight';
import MessageInteractions from './MessageInteractions';
import { BottomReplyContainer } from './BottomReplyContainer';
import { MessageReply } from './MessageReply';
import { parseMessageReference } from '../../helpers/parseMessageReference';
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
import MessageTranslate from './MessageTranslate';
import { isUnresolvedSenderId } from '../../helpers/isUnresolvedSenderId';
import TranslatedMessageBody from './TranslatedMessageBody';
import { useMessageTranslation } from '../../hooks/useMessageTranslation';
import { resolveTranslateMode } from '../../utils/translateModePolicy';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { parseMessageBody } from '../../helpers/parseMessageBody';
import { chatTextStyle } from '../../helpers/typography';
import { useMessageHeapState } from '../../hooks/useMessageHeapState';
import { DoubleTick, LockIcon, LockOffIcon } from '../../assets/icons';
import { useT } from '../../i18n/useT';
import { useFileToken } from '../../hooks/useFileToken';
import {
  appendFileToken,
  isSecureFileUrl,
  requestFileTokenRecovery,
} from '../../helpers/secureFileUrl';
import { placeholderKey } from '../../e2ee/stanza';
import { useXmppClient } from '../../context/xmppProvider';
import { useSendMessage } from '../../hooks/useSendMessage';
import { MessageReaction } from './MessageReaction';
import { EmojiPickerSheet } from './EmojiPickerSheet';
import { reactionsEnabled } from '../../helpers/reactionsConfig';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { hapticTap } from '../../helpers/haptics';
import { useTheme } from '../../hooks/useTheme';
import { isOpaqueXmppUserId } from '../../helpers/xmppIdShape';
import {
  getUserLookupStatus,
  requestUsers,
  subscribeUserResolver,
} from '../../helpers/userResolver';

// Stable-width stand-in for the sender name while its lookup is pending.
const SENDER_NAME_PLACEHOLDER = '\u2026';

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
    theme,
  }) =>
    deleted
      ? theme.systemMessageBackground
      : isUser
      ? backgroundMessageUser || theme.messageBackgroundUser
      : backgroundMessage || theme.messageBackground};
`;

const CustomMessageText = styled.Text<{
  isUser: boolean;
  colorUser?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
}>`
  font-size: ${({ fontSize }) => fontSize ?? 16}px;
  ${({ fontWeight }) => (fontWeight ? `font-weight: ${fontWeight};` : '')}
  color: ${({ color, colorUser, isUser, theme }) =>
    isUser ? colorUser || theme.messageTextUser : color || theme.messageText};
`;

const CustomMessagePhoto = styled.Image`
  width: 40px;
  height: 40px;
  border-radius: 20px;
`;

const CustomMessagePhotoContainer = styled.TouchableOpacity`
  margin-right: 10px;
`;

const CustomUserName = styled.Text<{
  color?: string;
  media: boolean;
  fontSize?: number;
  fontWeight?: string;
}>`
  font-size: ${({ fontSize }) => fontSize ?? 14}px;
  font-weight: ${({ fontWeight }) => fontWeight ?? 500};
  padding-bottom: 8px;
  padding-left: ${({media}) => media ? '16px': 0};
  padding-top: ${({media}) => media ? '8px': 0};
  color: ${({ color, theme }) => color || theme.text};
`;

const CustomMessageTimestamp = styled.Text<{
  isUser?: boolean;
  color?: string;
  colorUser?: string;
}>`
  font-size: 12px;
  color: ${({ isUser, color, colorUser, theme }) =>
    isUser ? colorUser || theme.textMuted : color || theme.textMuted};
  margin-top: 5px;
  align-self: flex-end;
`;

const CustomTimestampRow = styled.View<{media: boolean}>`
  flex-direction: row;
  align-items: center;
  align-self: flex-end;
  margin-top: 4;
  gap: 4;
  padding-right: ${({media}) => media ? '10px': 0};
`;

const clockCache = new Map<string, string>();
const formatClock = (date: string | Date): string => {
  const key = String(date);
  const cached = clockCache.get(key);
  if (cached !== undefined) {return cached;}
  const d = new Date(date);
  const label = Number.isNaN(d.getTime())
    ? ''
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (clockCache.size > 5000) {clockCache.clear();}
  clockCache.set(key, label);
  return label;
};

const Message: React.FC<MessageProps> = ({ message, isUser, isReply }) => {
  const dispatch = useDispatch();
  const { client } = useXmppClient();
  const { config, langSource, user, translateMode } = useChatSettingState();
  // Single theme read per message; the two colour overrides below are the
  // only per-render allocations added for theming (memoized on the theme
  // object, which useTheme keeps stable across renders).
  const theme = useTheme();
  const t = useT();
  const themedStyles = useMemo(
    () => ({
      muted: { color: theme.textMuted },
      failed: { color: theme.danger },
    }),
    [theme]
  );

  // `enableTranslates` predates the `translates` config block; keep it
  // working so existing hosts don't lose translations on upgrade.
  const isTranslatesEnabled = Boolean(
    config?.translates?.enabled || config?.enableTranslates
  );
  const effectiveTranslateMode = resolveTranslateMode(
    config?.translates,
    translateMode
  );

  // Auto mode (the default): show the translation inline as the primary body,
  // with the original quoted above. Own messages are never translated — the
  // sender already knows what they wrote (TranslatedMessageBody skips the
  // quote for isUser, and we simply render the original for them). Mirrors
  // the web SDK's Message.tsx.
  const isAutoTranslate =
    isTranslatesEnabled && effectiveTranslateMode !== 'manual';
  const readerLocale =
    config?.translates?.readerLocale || config?.i18n?.locale || langSource;
  const translationDisplay = useMessageTranslation(
    message,
    readerLocale,
    isAutoTranslate
  );

  // `usersSet` is the canonical, continuously-updated identity store; the
  // copy riding on a message is a snapshot of whoever sent it, whenever
  // they sent it. Resolve both the avatar and the display name through
  // usersSet first, falling back to the message for senders usersSet has
  // never seen (broadcast/system accounts).
  //
  // This matters more since the persist layer stopped caching per-message
  // avatars: a cache-restored message carries no profileImage at all (see
  // PERSISTED_MESSAGE_USER_FIELDS), so reading only the message-level copy
  // leaves a blank initials circle for senders whose name resolved fine.
  const senderRawId = String(message.user?.id || '');
  const senderLocal = senderRawId.split('@')[0];
  // Granular: re-render only when THIS sender's entry changes, not on every
  // usersSet update.
  const senderEntry = useSelector(
    (state: RootState) => {
      const set = state.rooms.usersSet as Record<string, any> | undefined;
      return set?.[senderLocal] || set?.[senderRawId];
    }
  ) as Record<string, any> | undefined;
  // A usersSet hit with blank names is worth no more than a miss.
  const usersSetDisplayName = senderEntry
    ? `${senderEntry.firstName ?? ''} ${senderEntry.lastName ?? ''}`.trim() ||
      String(senderEntry.name || '').trim()
    : '';
  // 'Deleted User' baked into message.user.name only means "not resolved at
  // insert time" (the real answer is the lookup's 404 below), and a raw
  // xmpp id is never a name.
  const safeMessageName =
    message.user?.name &&
    message.user.name !== 'Deleted User' &&
    !isOpaqueXmppUserId(message.user.name)
      ? message.user.name
      : '';
  const safeSenderLocal = isOpaqueXmppUserId(senderLocal) ? '' : senderLocal;
  // Ask the backend for a sender nobody has told us about (a big room ships
  // only 30 members). The resolver debounces and de-duplicates.
  useEffect(() => {
    if (!senderEntry && senderLocal) requestUsers([senderLocal]);
  }, [senderEntry, senderLocal]);
  const lookupStatus = useSyncExternalStore(
    subscribeUserResolver,
    () => getUserLookupStatus(senderLocal),
    () => 'pending' as const
  );
  // The sender's name stamped on the stanza's <data> by clients of this SDK.
  // LAST resort only (older clients and backends): used once the lookup has
  // finished without a name, and never written into usersSet. Insert-time
  // enrichment may have baked it into message.user.name, so a message name
  // equal to it counts as <data>, not as a member name.
  const dataFull = String((message as any)?.fullName || '').trim();
  const dataComposed =
    dataFull ||
    `${String((message as any)?.senderFirstName || '').trim()} ${String(
      (message as any)?.senderLastName || ''
    ).trim()}`.trim();
  const trustedMessageName =
    safeMessageName && safeMessageName !== dataComposed ? safeMessageName : '';
  // Chain: usersSet (member or lookup result) > a name from a member/seed >
  // muted placeholder while the lookup is pending > <data> name > readable
  // id > Unknown user ('Deleted User' only when the backend said 404).
  const senderNamePending =
    !usersSetDisplayName && !trustedMessageName && lookupStatus === 'pending';
  const unresolvedPlaceholder =
    lookupStatus === 'notfound' && !dataComposed
      ? 'Deleted User'
      : t('user.unknown');
  const senderDisplayName = senderNamePending
    ? SENDER_NAME_PLACEHOLDER
    : usersSetDisplayName ||
      trustedMessageName ||
      dataComposed ||
      safeSenderLocal ||
      unresolvedPlaceholder;
  // The placeholder is a loading state, not a name: it must not seed the
  // generic avatar's initials or a stale caption.
  //
  // A broadcast posted by the app itself arrives with the ROOM's own id as
  // its occupant resource, so no roster ever resolves it and the name chain
  // ends at 50 characters of hex. Captioning a bubble with that tells the
  // reader strictly less than showing nothing.
  const hasRealSenderName = !isUnresolvedSenderId(senderDisplayName);
  const fileToken = useFileToken();
  const [avatarFailed, setAvatarFailed] = useState<string | null>(null);
  const rawProfileImage = String(
    senderEntry?.profileImage ||
      message.user?.profileImage ||
      (message.user as any)?.photoURL ||
      ''
  ).trim();
  const senderProfileImage =
    rawProfileImage && rawProfileImage !== 'none' && rawProfileImage !== avatarFailed
      ? appendFileToken(rawProfileImage, fileToken)
      : '';
  const { idSet, failedIdSet } = useMessageHeapState();
  const { retryMessage } = useSendMessage();

  const [isPressed, setIsPressed] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const [contextMenuPosition, setContextMenuPosition] = useState<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const messageRef = useRef<View>(null);
  const bubbleRef = useRef<View>(null);

  const handleUserAvatarClick = (user: IUser): void => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    dispatch(setSelectedUser(user));
  };

  const replyRef = parseMessageReference(message);

  const handleReplyMessage = () => {
    dispatch(setEditAction({ isEdit: false }));

    // An in-channel reply opens its PARENT's thread.
    const parent = !isReply ? parseMessageReference(message) : null;
    if (parent) {
      dispatch(
        setActiveMessage({
          id: parent.id,
          chatJID: parent.roomJid || message.roomJid,
        })
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
    if (!reactionsEnabled(config) || config?.disableInteractions) {return;}
    const sender = { firstName: user.firstName, lastName: user.lastName };
    const own = message.reaction?.[user.xmppUsername || '']?.emoji || [];
    const next = own.includes(emoji)
      ? own.filter((reaction) => reaction !== emoji)
      : [...own, emoji];
    client?.sendMessageReactionStanza(message.id, message.roomJid, next, sender);
  };

  // Long-press → capture the bubble's on-screen bounding box. The actual
  // menu placement (above / below, clamped to the viewport) is done in
  // MessageInteractions, which measures the rendered menu height via
  // onLayout — more accurate than estimating it here, and it's what keeps
  // the menu adjacent to the message instead of floating far above (#13).
  const handleLongPress = () => {
    const target = (bubbleRef.current ?? messageRef.current) as any;
    if (target?.measureInWindow) {
      // Use measureInWindow — the SAME API the overlay host uses to find
      // its own window origin. Both are then in identical window
      // coordinates, so MessageInteractions' host-local conversion
      // (subtract origin) is exact. Mixing this with UIManager.measure
      // (pageX/pageY) drifted on Android (status-bar offset) and pushed the
      // "below" menu too far from the message.
      target.measureInWindow(
        (x: number, y: number, width: number, height: number) => {
          setContextMenuPosition({
            left: x,
            right: x + width,
            top: y,
            bottom: y + height,
          });
        }
      );
    } else if (target) {
      const nodeHandle = findNodeHandle(target);
      if (nodeHandle) {
        UIManager.measure(nodeHandle, (_x, _y, width, height, pageX, pageY) => {
          setContextMenuPosition({
            left: pageX,
            right: pageX + width,
            top: pageY,
            bottom: pageY + height,
          });
        });
      }
    }
    setIsPressed(true);
  };

  // Long-press is a NATIVE recognizer over the whole bubble column, not the
  // Pressable's JS timer: the timer was lost whenever an inner responder
  // (link text, media, reply quote, reactions) took the touch first, or the
  // list stole it on the slightest drift — "works every other time". The
  // recognizer fires wherever the finger lands, and once it does the touch
  // is cancelled for everything underneath, so no tap handler fires on top.
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .runOnJS(true)
        .minDuration(350)
        .maxDistance(12)
        .enabled(!config?.disableInteractions)
        .onStart(() => {
          hapticTap();
          handleLongPress();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config?.disableInteractions]
  );

  // Body text size/weight is set on the parser's leaf <Text>s — the markdown
  // wraps content in <View>s which break Text-style inheritance, so the bubble
  // wrapper's fontSize alone never reached the actual text.
  // The parser wraps paragraphs / list items in <View>s, so the bubble's
  // text colour never reaches the leaf <Text>s by inheritance — put the
  // ink on the base leaf style explicitly (theme-aware).
  const bodyTextStyle = useMemo(
    () => ({
      ...chatTextStyle(config?.typography?.messageText),
      color: isUser ? theme.messageTextUser : theme.messageText,
    }),
    [config?.typography?.messageText, isUser, theme]
  );
  // In auto mode, render the translation as the primary body — but NEVER for
  // the reader's own messages (they wrote it; no point translating it back).
  const isUndecryptable =
    message.undecryptable === 'true' && !message.isDeleted;
  const showInlineTranslation =
    isAutoTranslate &&
    translationDisplay.hasTranslation &&
    !isUser &&
    !isUndecryptable;
  const bodyToRender = showInlineTranslation
    ? translationDisplay.displayText
    : message.body;
  const textFilter = config?.messageTextFilter;
  const messageText = useMemo(
    () =>
      textFilter?.enabled
        ? parseMessageBody(
            textFilter.filterFunction(bodyToRender),
            bodyTextStyle,
            theme
          )
        : parseMessageBody(bodyToRender, bodyTextStyle, theme),
    [textFilter, bodyToRender, bodyTextStyle, theme]
  );
  const timeLabel = useMemo(() => formatClock(message.date), [message.date]);

  const isFailed = failedIdSet.has(message.id);
  const isPending =
    !isFailed && (idSet.has(message.id) || message?.pending || false);

  const onRetryPress = () => {
    if (isFailed) {retryMessage(message.id);}
  };

  // The bubble, as a function: the list draws it in place, and the context
  // menu draws a second copy over the dimmed chat (WhatsApp style) while
  // the original steps aside.
  const renderBubble = (preview: boolean) => (
    <CustomMessageBubble
      {...((preview
        ? // The copy in the context menu: same look, full measured
          // width (its box is the original's), never the measuring
          // target.
          { style: styles.previewBubble }
        : {
            ref: bubbleRef,
            collapsable: false,
            // Hidden while the menu shows its copy over the dim, so
            // the message is not on screen twice.
            style:
              isPressed && contextMenuPosition
                ? styles.hiddenBubble
                : undefined,
          }) as any)}
      isUser={isUser}
      deleted={message.isDeleted}
      isMedia={message?.isMediafile === 'true' && !message?.isDeleted}
    >
      {!isUser && hasRealSenderName && (
        <CustomUserName
          // Historically `config.colors.primary` with a plain-text
          // fallback; theme.primary carries the same value in light
          // mode and the dark accent in dark mode.
          color={config?.colors?.primary ? theme.primary : undefined}
          media={message?.isMediafile === 'true'}
          fontSize={config?.typography?.senderName?.fontSize}
          fontWeight={config?.typography?.senderName?.fontWeight as any}
          style={senderNamePending ? styles.pendingName : undefined}
        >
          {senderDisplayName}
        </CustomUserName>
      )}
      {!isReply && !!replyRef?.text && (
        <MessageReply
          handleReplyMessage={handleReplyMessage}
          isUser={isUser}
          text={replyRef.text}
          userName={replyRef.userName}
          color={theme.primary}
        />
      )}

      {message?.isMediafile === 'true' && !message?.isDeleted ? (
        <MediaMessage
          mimeType={message.mimetype}
          messageText={message.locationPreview}
          location={message?.location}
          message={message}
          isUser={isUser}
        />
      ) : (
        <>
          {message.isDeleted && message.id !== 'delimiter-new' ? (
            <DeletedMessage />
          ) : isUndecryptable ? (
            <View style={styles.undecryptable}>
              <LockIcon
                width={15}
                height={15}
                color={theme.textSecondary}
              />
              <Text
                style={[
                  styles.undecryptableText,
                  themedStyles.muted,
                  {
                    fontSize:
                      config?.typography?.messageText?.fontSize ?? 15,
                  },
                ]}
              >
                {t(placeholderKey(message.e2eeError))}
              </Text>
            </View>
          ) : (
            <CustomMessageText
              isUser={isUser}
              fontSize={config?.typography?.messageText?.fontSize}
              fontWeight={config?.typography?.messageText?.fontWeight as any}
            >
              {/* Auto mode: the parsed body IS the translation; wrap it
                  so the original shows as a dimmed accent-bar quote
                  above it. Plain body otherwise. */}
              {showInlineTranslation ? (
                <TranslatedMessageBody
                  isUser={isUser}
                  originalText={translationDisplay.originalText}
                  accentColor={theme.primary}
                >
                  <Text>{messageText}</Text>
                </TranslatedMessageBody>
              ) : (
                <Text>{messageText}</Text>
              )}
            </CustomMessageText>
          )}
        </>
      )}
      {/* Manual mode: a "Translate" link the reader taps (auto mode
          renders the translation inline in the body above). Never on
          the reader's own messages. */}
      {!isUser &&
        !isUndecryptable &&
        isTranslatesEnabled &&
        effectiveTranslateMode === 'manual' && (
          <MessageTranslate
            message={message}
            config={config}
            isUser={isUser}
            readerLocale={readerLocale}
          />
        )}
      {/* <View style={styles.timestampRow}> */}
      <CustomTimestampRow media={message?.isMediafile === 'true'}>
        {!config?.disableSentLogic && isUser && isPending && (
          <Text style={[styles.timestampText, themedStyles.muted]}>
            {t('message.sending')}
          </Text>
        )}
        {!config?.disableSentLogic && isUser && isFailed && (
          <Text
            onPress={onRetryPress}
            style={[styles.failedText, themedStyles.failed]}
            accessibilityRole="button"
            accessibilityLabel="Retry sending message"
          >
            {t('message.failedRetry')}
          </Text>
        )}
        {message?.isEdited && !message?.isDeleted && (
          <Text style={[styles.editedText, themedStyles.muted]}>{t('message.edited')}</Text>
        )}
        {message?.unencrypted && !message?.isDeleted && (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('e2ee.notEncrypted')}
            accessibilityHint={t('e2ee.notEncryptedHint')}
            testID="message-not-encrypted"
            onPress={() =>
              Alert.alert(t('e2ee.notEncrypted'), t('e2ee.notEncryptedHint'))
            }
          >
            <LockOffIcon width={13} height={13} color={theme.danger} />
          </Pressable>
        )}
        <Text style={[styles.timestampText, themedStyles.muted]}>
          {timeLabel}
        </Text>
        {!config?.disableSentLogic && isUser && !isPending && !isFailed && (
          <DoubleTick />
        )}
      </CustomTimestampRow>

      {/* The jump-to-message ring: on the bubble in the list, not on the
          context menu's copy of it. */}
      {!preview && <BubbleHighlight messageId={String(message.id)} />}
    </CustomMessageBubble>
  );

  return (
    <View>
      {isPressed && <View style={styles.overlay} />}
      <View
        ref={messageRef}
        style={[
          styles.customMessageContainer,
          {
            justifyContent: isUser ? 'flex-end' : 'flex-start',
            marginBottom: 0,
          },
          // justify-content: ${({ isUser }) => (isUser ? "flex-end" : "flex-start")},
          // margin-bottom: ${(props) => !!props.reply && "20px"},
        ]}
      >
        {!isUser && (
          <CustomMessagePhotoContainer
            // `disableProfilesInteractions` gates every entry point to the
            // user-profile popup: this in-bubble avatar AND the chat-title
            // press in ChatHeader. When disabled we still render the avatar
            // visually but make it non-interactive (no press, no a11y
            // affordance) — consumers who want it gone entirely can return
            // null from a custom message component.
            onPress={
              config?.disableProfilesInteractions
                ? undefined
                : () =>
                    handleUserAvatarClick({
                      ...message.user,
                      ...(senderEntry
                        ? {
                            firstName: senderEntry.firstName,
                            lastName: senderEntry.lastName,
                            profileImage: senderEntry.profileImage,
                            description: senderEntry.description,
                          }
                        : {}),
                      // The pending placeholder is not a name.
                      name:
                        hasRealSenderName && !senderNamePending
                          ? senderDisplayName
                          : '',
                    } as IUser)
            }
            disabled={!!config?.disableProfilesInteractions}
            accessible={!config?.disableProfilesInteractions}
          >
            {senderProfileImage ? (
              <CustomMessagePhoto
                testID="message-sender-avatar"
                source={{ uri: senderProfileImage }}
                onError={() => {
                  if (isSecureFileUrl(rawProfileImage)) {requestFileTokenRecovery();}
                  setAvatarFailed(rawProfileImage);
                }}
              />
            ) : (
              <Avatar username={senderNamePending ? '' : senderDisplayName} />
            )}
          </CustomMessagePhotoContainer>
        )}
        <GestureDetector gesture={longPress}>
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
          // A plain tap anywhere on a message bubble dismisses the
          // keyboard. The FlatList's keyboardShouldPersistTaps="handled"
          // already dismisses taps on the empty GAPS between bubbles, but
          // the bubble Pressable itself is a touch responder, so taps that
          // landed on a message were "handled" and the keyboard stayed —
          // which is exactly the "closes only every other time" symptom
          // (hit a gap → close, hit a bubble → stay). Explicitly dismissing
          // here makes it reliable across the whole list. onPress does NOT
          // fire when onLongPress fires, so opening MessageInteractions via
          // long-press never triggers this dismiss.
          onPress={() => Keyboard.dismiss()}
        >
          <View>
          {renderBubble(false)}
          {/* One row on the bubble's bottom edge: the thread pill (as on
              web) and the reaction chips side by side. */}
          {((!isReply && (message?.reply?.length || 0) > 0) ||
            (!!message.reaction && reactionsEnabled(config))) && (
            <View
              style={[
                styles.reactionRow,
                isUser ? styles.reactionRowUser : styles.reactionRowOther,
              ]}
            >
              {!isReply && (message?.reply?.length || 0) > 0 && (
                <BottomReplyContainer
                  isUser={isUser}
                  onClick={handleReplyMessage}
                  reply={message.reply!}
                />
              )}
              {message.reaction && reactionsEnabled(config) && (
                <MessageReaction
                  reaction={message.reaction}
                  changeReaction={handleReactionMessage}
                  color={theme.primary}
                  userName={`${user.firstName || ''} ${user.lastName || ''}`.trim()}
                  interactive={!config?.disableInteractions}
                />
              )}
            </View>
          )}
          </View>
        </Pressable>
        </GestureDetector>
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
          onOpenEmojiPicker={() => setEmojiPickerOpen(true)}
          preview={renderBubble(true)}
        />
      )}
      {emojiPickerOpen && (
        <EmojiPickerSheet
          visible
          onClose={() => setEmojiPickerOpen(false)}
          onPick={handleReactionMessage}
        />
      )}
    </View>
  );
};

const MemoMessage = React.memo(Message);
export { MemoMessage as Message };

const styles = StyleSheet.create({
  previewBubble: {
    maxWidth: '100%',
  },
  hiddenBubble: {
    opacity: 0,
  },
  pendingName: { opacity: 0.5, minWidth: 14 },
  customMessageContainer: {
    flexDirection: 'row',
    padding: 10,
    alignItems: 'flex-end',
    position: 'relative',
  },
  reactionRow: {
    marginTop: -10,
    zIndex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  reactionRowUser: {
    alignSelf: 'flex-end',
    marginRight: 8,
  },
  reactionRowOther: {
    alignSelf: 'flex-start',
    marginLeft: 8,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
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
  undecryptable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    maxWidth: 260,
  },
  undecryptableText: {
    flexShrink: 1,
    fontStyle: 'italic',
  },
  timestampText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#999',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  // Small muted "edited" marker shown before the timestamp (Slack/WhatsApp
  // style). Italic + same muted grey so it reads as metadata, not content.
  editedText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#999',
    fontStyle: 'italic',
    marginRight: 6,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
