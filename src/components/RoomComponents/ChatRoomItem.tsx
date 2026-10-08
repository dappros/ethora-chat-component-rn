import React, { useCallback, useMemo } from 'react';
import { UNREAD_CAP_PAGE } from '../../roomStore/roomsSlice';
import { useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { IMessage } from '../../types/types';
import { useFileToken } from '../../hooks/useFileToken';
import { appendFileToken } from '../../helpers/secureFileUrl';
import { IConfig, IRoom } from '../../types/types';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import {
  ChatItem,
  ChatInfo,
  ChatName,
  LastMessage,
  UserCount,
} from '../styled/RoomListComponents';
import Composing from '../styled/StyledInputComponents/Composing';
import { Text, View } from 'react-native';
import LastMessageItem from './LastMessageItem';
import { LastRoomMessageText } from './styled/StyledRoomComponents';
import { useTheme } from '../../hooks/useTheme';
import { resolveTheme } from '../../theme/theme';
import { BellOffIcon, LockIcon } from '../../assets/icons';
import { useT } from '../../i18n/useT';
import { composeName } from '../../helpers/displayName';
import { isUnresolvedSenderId } from '../../helpers/isUnresolvedSenderId';

interface ChatRoomItemProps {
  chat: IRoom;
  index?: number;
  isDriver?: boolean;
  config?: IConfig;
}

const ChatRoomItem: React.FC<ChatRoomItemProps> = ({
  chat,
  index,
  isDriver,
  config,
}) => {
  // Rows can be rendered with an explicit `config` prop (tests, hosts
  // composing their own list); honour its colours over the store's.
  const storeTheme = useTheme();
  const t = useT();
  const theme = useMemo(
    () => (config ? resolveTheme(config) : storeTheme),
    [config, storeTheme]
  );
  // Room icons can live on the membership-gated secure-files host.
  const fileToken = useFileToken();
  const displayName = String(chat?.title || chat?.name || '').trim();

  // usersSet is the canonical name store — the same one Message.tsx
  // resolves sender names through. The preview must go through it too
  // (mirrors web's ChatRoomItem.withAuthorFallback): a message restored
  // from the persist cache carries only a compacted user, so reading
  // `user.name` alone left this line showing a raw JID after a refresh.
  const usersSet = useSelector((state: RootState) => state.rooms.usersSet) as
    | Record<string, any>
    | undefined;

  const withAuthorFallback = useCallback(
    (message?: IMessage): IMessage | undefined => {
      if (!message) {return message;}
      const rawUserId = String(message?.user?.id || '');
      const localId = rawUserId.split('@')[0];
      const entry = usersSet?.[localId] ?? usersSet?.[rawUserId];
      const fromUsersSet = entry
        ? composeName(entry.firstName, entry.lastName)
        : '';

      const ownName = String(message?.user?.name || '').trim();
      const safeName =
        fromUsersSet || (isUnresolvedSenderId(ownName) ? '' : ownName);

      return {
        ...message,
        user: {
          ...message.user,
          name: safeName,
        },
      };
    },
    [usersSet]
  );

  const lastMessage = useMemo(() => {
    if (!chat?.messages || chat.messages.length === 0) {
      return chat?.lastMessage?.body
        ? withAuthorFallback(chat.lastMessage as IMessage)
        : undefined;
    }

    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (!msg.deleted && !msg.isDeleted) {
        return withAuthorFallback(msg);
      }
    }
    return undefined;
  }, [chat?.messages, chat?.lastMessage, withAuthorFallback]);

  // Mirrors web's formatter: tolerates undefined/garbage inputs (returns
  // undefined instead of "NaN:NaN"), and uses HH:MM today / MM/DD this
  // year / YYYY/MM/DD older.
  const formatTimeToHHMM = (
    isoTime?: string | Date | number
  ): string | undefined => {
    if (isoTime == null) {return undefined;}
    let date: Date;
    try {
      if (isoTime instanceof Date) {
        date = isoTime;
      } else if (typeof isoTime === 'number') {
        date = new Date(isoTime);
      } else if (typeof isoTime === 'string') {
        const trimmed = isoTime.trim();
        date = /^\d+$/.test(trimmed)
          ? new Date(parseInt(trimmed, 10))
          : new Date(trimmed);
      } else {
        return undefined;
      }
      if (isNaN(date.getTime())) {return undefined;}
      const now = new Date();
      if (date.getFullYear() !== now.getFullYear()) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}/${month}/${day}`;
      }
      if (date.toDateString() === now.toDateString()) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
      }
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${month}/${day}`;
    } catch {
      return undefined;
    }
  };

  const stamp = formatTimeToHHMM(lastMessage?.date ?? chat?.createdAt);

  return (
    <ChatItem key={index}>
      <View pointerEvents="none">
        <ProfileImagePlaceholder
          name={displayName}
          icon={appendFileToken(chat?.icon, fileToken)}
          active={false}
        />
      </View>
      <View
        style={{
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 2,
          width: '100%',
          paddingVertical: 8,
          paddingRight: 8,
          borderBottomWidth: 1,
          // `divider` reads against the list ground; the lighter border
          // tone was paler than the ground itself, so the separators vanished.
          borderBottomColor: theme.divider,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <ChatInfo>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ flexShrink: 1 }}>
                <ChatName text={displayName} />
              </View>
              {chat?.e2ee && (
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={t('e2ee.roomEncrypted')}
                  testID="room-e2ee-lock"
                >
                  <LockIcon width={13} height={13} color={theme.textSecondary} />
                </View>
              )}
              {/* Notifications off (chat profile / swipe): the crossed bell
                  after the name, as in the messengers. */}
              {chat?.muted && (
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={t('action.muted')}
                  testID="room-muted"
                >
                  <BellOffIcon width={14} height={14} color={theme.textSecondary} />
                </View>
              )}
            </View>
          </ChatInfo>
          {stamp ? (
            <UserCount
              style={{
                color: theme.textSecondary,
                fontSize: 12,
              }}
              text={stamp}
            />
          ) : null}
        </View>
        <View
          style={{
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            minHeight: 40,
          }}
        >
          {/* {chat.composing ? (
            <Composing
              usersTyping={chat.composingList}
              style={{ color: "#141414" }}
            />
            ) : lastMessage?.body ? (
            <View
              style={{
                display: "flex",
                width: "80%",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            >
              <View
                style={{
                  height: 20,
                }}
              >
                <Text style={{ fontWeight: "600", textAlign: "right" }}>
                  {lastMessage.user.name || ""}:
                </Text>
              </View>
              <View
                style={{
                  height: 20,
                  maxWidth: 200,
                  overflow: "hidden",
                }}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={{
                    textAlign: "right",
                  }}
                >
                  {lastMessage.body || "Chat created"}
                </Text>
              </View>
            </View>
          ) : null} */}
          {chat.composing ? (
            <Composing
              usersTyping={chat.composingList}
              // style={{ color: !isChatActive ? '#141414' : '#fff' }}
            />
          ) : lastMessage?.body ? (
            <LastMessageItem lastMessage={lastMessage} />
          ) : chat.messages.length === 0 && chat.historyComplete ? (
            <LastRoomMessageText>Room created</LastRoomMessageText>
          ) : undefined}
          {chat.unreadMessages && chat.unreadMessages > 0 ? (
            <View
              style={{
                borderRadius: 8,
                // A muted chat still counts, but greyed: nothing to rush to.
                backgroundColor: chat?.muted ? theme.textSecondary : theme.primary,
                padding: 2,
                minWidth: 24,
                minHeight: 24,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                marginLeft: 'auto',
              }}
            >
              <Text
                style={{
                  // color: isChatActive ? "#141414" : "#fff",
                  color: chat?.muted ? theme.textOnPrimary : theme.text,
                  fontSize: 14,
                  fontWeight: '600',
                }}
              >
                {chat.unreadCapped && (chat.unreadMessages || 0) >= UNREAD_CAP_PAGE
                  ? `${chat.unreadMessages}+`
                  : chat.unreadMessages || ''}
              </Text>
            </View>
          ) : null}
        </View>
        {isDriver && (
          // Darker than the list's own ground, otherwise the separator
          // disappears into it — white and the old highlight hairline both
          // did.
          <View
            style={{ height: 1, backgroundColor: theme.divider, marginTop: 8 }}
          />
        )}
      </View>
    </ChatItem>
  );
};

export default React.memo(ChatRoomItem);
