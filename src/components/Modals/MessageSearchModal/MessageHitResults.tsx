/** @format */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../../roomStore';
import { useT, useUiLocale } from '../../../i18n/useT';
import { useTheme } from '../../../hooks/useTheme';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { getIconColor } from '../../../helpers/getIconColor';
import type { ChatTheme } from '../../../theme/theme';
import {
  hitKey,
  MessageSearchHit,
} from '../../../networking/api-requests/messageSearch.api';
import { buildSnippet } from './snippet';
import { resolveSender } from './resolveSender';
import { requestUsers } from '../../../helpers/userResolver';
import { openSearchHit, resolveHitRoomJid } from './openHit';

const formatWhen = (iso: string, locale?: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {return '';}
  const sameYear = date.getFullYear() === new Date().getFullYear();
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date);
  } catch {
    return date.toDateString();
  }
};

/**
 * Shared by the search screen and the room list: who sent a hit, whether its
 * room can be opened, and the tap action (select the room, request the jump).
 */
export function useMessageHitActions() {
  const t = useT();
  const dispatch = useDispatch();
  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const activeRoomJID = useSelector(
    (state: RootState) => state.rooms.activeRoomJID
  );
  const usersSet = useSelector((state: RootState) => state.rooms.usersSet);
  const myXmppUsername = useSelector(
    (state: RootState) => state.chatSettingStore.user?.xmppUsername
  );

  /** True when the hit's sender is neither me nor a known profile. */
  const isSenderUnknown = useCallback(
    (hit: MessageSearchHit): boolean => {
      const room: any = rooms[hit.room];
      const { name, isSelf } = resolveSender(hit, {
        usersSet: usersSet as Record<string, any>,
        members: room?.members as any[],
        myXmppUsername,
      });
      return !isSelf && !name;
    },
    [rooms, usersSet, myXmppUsername]
  );

  const senderName = useCallback(
    (hit: MessageSearchHit): string => {
      const room: any = rooms[hit.room];
      const { name, isSelf } = resolveSender(hit, {
        usersSet: usersSet as Record<string, any>,
        members: room?.members as any[],
        myXmppUsername,
      });
      if (isSelf) {return t('search.messages.you');}
      return name || t('search.messages.someone');
    },
    [rooms, usersSet, myXmppUsername, t]
  );

  const open = useCallback(
    (hit: MessageSearchHit): boolean =>
      openSearchHit(dispatch as any, rooms, activeRoomJID, hit),
    [dispatch, rooms, activeRoomJID]
  );

  const isReachable = useCallback(
    (hit: MessageSearchHit) => Boolean(resolveHitRoomJid(rooms, hit)),
    [rooms]
  );

  return {
    rooms,
    activeRoomJID,
    senderName,
    isSenderUnknown,
    open,
    isReachable,
  };
}

interface MessageHitRowProps {
  hit: MessageSearchHit;
  query: string;
  /** Prefix the sender with the chat's title (search across chats). */
  showRoom: boolean;
  onOpen: (hit: MessageSearchHit) => void;
}

export const MessageHitRow: React.FC<MessageHitRowProps> = ({
  hit,
  query,
  showRoom,
  onOpen,
}) => {
  const t = useT();
  const locale = useUiLocale();
  const theme = useTheme();
  const { config } = useChatSettingState();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const primary = getIconColor(config);
  const { rooms, senderName, isSenderUnknown, isReachable } =
    useMessageHitActions();

  // A sender not in usersSet or the room's members is looked up once
  // (requestUsers dedupes and caches failures); the row re-renders when the
  // profile lands in usersSet.
  const unknownSender = isSenderUnknown(hit);
  useEffect(() => {
    if (unknownSender && hit.from) {requestUsers([hit.from]);}
  }, [unknownSender, hit.from]);

  const room: any = rooms[hit.room];
  const reachable = isReachable(hit);
  const title = showRoom
    ? `${room?.title || t('search.messages.chat')} · ${senderName(hit)}`
    : senderName(hit);

  return (
    <TouchableOpacity
      testID={`message-search-hit-${hitKey(hit)}`}
      activeOpacity={0.7}
      disabled={!reachable}
      onPress={() => onOpen(hit)}
      style={[styles.hit, !reachable && styles.hitDisabled]}
    >
      <View style={styles.hitHead}>
        <Text style={styles.hitTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.hitWhen}>{formatWhen(hit.createdAt, locale)}</Text>
      </View>
      <Text style={styles.snippet} numberOfLines={4}>
        {buildSnippet(hit.body, query).map((part, index) => (
          <Text
            key={index}
            style={
              part.match
                ? [
                    styles.match,
                    { color: primary, backgroundColor: primary + '1F' },
                  ]
                : undefined
            }
          >
            {part.text}
          </Text>
        ))}
      </Text>
    </TouchableOpacity>
  );
};

export const HitSeparator: React.FC = () => {
  const theme = useTheme();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider }}
    />
  );
};

interface MessageHitListProps {
  hits: MessageSearchHit[];
  query: string;
  showRoom: boolean;
  onOpen: (hit: MessageSearchHit) => void;
}

/** Non-virtualised list of hit rows, for use inside another scroll view. */
export const MessageHitList: React.FC<MessageHitListProps> = ({
  hits,
  query,
  showRoom,
  onOpen,
}) => (
  <View>
    {hits.map((hit, index) => (
      <React.Fragment key={hitKey(hit)}>
        {index > 0 && <HitSeparator />}
        <MessageHitRow
          hit={hit}
          query={query}
          showRoom={showRoom}
          onOpen={onOpen}
        />
      </React.Fragment>
    ))}
  </View>
);

interface PillButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

/** "Show more" / "Retry": single line, centered, rounded, bordered. */
export const SecondaryPillButton: React.FC<PillButtonProps> = ({
  label,
  onPress,
  disabled,
  testID,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.pill, disabled && styles.hitDisabled]}
    >
      <Text style={styles.pillLabel} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const createStyles = (theme: ChatTheme) =>
  StyleSheet.create({
    hit: { paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
    hitDisabled: { opacity: 0.5 },
    hitHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    hitTitle: {
      flex: 1,
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    hitWhen: { color: theme.textMuted, fontSize: 12 },
    snippet: { color: theme.text, fontSize: 15 },
    match: { fontWeight: '600' },
    pill: {
      alignSelf: 'center',
      marginVertical: 12,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    pillLabel: { color: theme.textSecondary, fontSize: 14, fontWeight: '500' },
  });
