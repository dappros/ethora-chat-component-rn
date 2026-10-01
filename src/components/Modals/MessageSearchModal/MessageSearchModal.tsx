/** @format */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../../roomStore';
import { ModalContainerFullScreen } from '../styledModalComponents';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { SearchIcon } from '../../../assets/icons';
import { useT, useUiLocale } from '../../../i18n/useT';
import { useTheme } from '../../../hooks/useTheme';
import { getIconColor } from '../../../helpers/getIconColor';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import type { ChatTheme } from '../../../theme/theme';
import {
  hitKey,
  MessageSearchHit,
} from '../../../networking/api-requests/messageSearch.api';
import { buildSnippet } from './snippet';
import { resolveSender } from './resolveSender';
import {
  dayEndISO,
  dayStartISO,
  isBackwardsRange,
  isValidDay,
  matchPeople,
} from './searchFilters';
import {
  MIN_QUERY_LENGTH,
  SearchScope,
  useMessageSearch,
} from './useMessageSearch';
import { openSearchHit, resolveHitRoomJid } from './openHit';

const Separator = () => {
  const theme = useTheme();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider }}
    />
  );
};

interface MessageSearchModalProps {
  handleCloseModal: () => void;
}

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

const MessageSearchModal: React.FC<MessageSearchModalProps> = ({
  handleCloseModal,
}) => {
  const t = useT();
  const locale = useUiLocale();
  const dispatch = useDispatch();
  const theme = useTheme();
  const { config } = useChatSettingState();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const primary = getIconColor(config);
  const inputRef = useRef<TextInput>(null);

  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const activeRoomJID = useSelector(
    (state: RootState) => state.rooms.activeRoomJID
  );
  const usersSet = useSelector((state: RootState) => state.rooms.usersSet);
  const myXmppUsername = useSelector(
    (state: RootState) => state.chatSettingStore.user?.xmppUsername
  );

  const [query, setQuery] = useState('');
  const roomName = activeRoomJID ? activeRoomJID.split('@')[0] : undefined;
  const [scope, setScope] = useState<SearchScope>(
    activeRoomJID ? 'chat' : 'all'
  );

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sinceDay, setSinceDay] = useState('');
  const [untilDay, setUntilDay] = useState('');
  const [sender, setSender] = useState<{ id: string; name: string } | null>(
    null
  );
  const [senderQuery, setSenderQuery] = useState('');

  const backwards = isBackwardsRange(sinceDay, untilDay);
  // Memoised: the hook keys its request on these, and a fresh object per
  // render must not look like a changed filter.
  const filters = useMemo(
    () => ({
      fromUserId: sender?.id,
      since: backwards ? undefined : dayStartISO(sinceDay),
      until: backwards ? undefined : dayEndISO(untilDay),
    }),
    [sender?.id, sinceDay, untilDay, backwards]
  );
  const activeFilterCount =
    (sender ? 1 : 0) +
    (isValidDay(sinceDay) ? 1 : 0) +
    (isValidDay(untilDay) ? 1 : 0);
  const clearFilters = () => {
    setSender(null);
    setSenderQuery('');
    setSinceDay('');
    setUntilDay('');
  };

  // Who can be picked as the sender: this room's members, or everyone the
  // app knows when searching across chats. Members carry `_id`, the user id
  // the search endpoint filters on.
  const senderCandidates = useMemo(() => {
    if (!senderQuery.trim()) {return [];}
    const people =
      scope === 'chat'
        ? ((activeRoomJID && (rooms[activeRoomJID] as any)?.members) as any[]) ||
          []
        : Object.values(usersSet || {});
    return matchPeople(people as any[], senderQuery);
  }, [senderQuery, scope, rooms, activeRoomJID, usersSet]);

  // A backwards range has no honest result, so it searches nothing (and says
  // so) instead of quietly dropping the dates.
  const search = useMessageSearch(
    backwards ? '' : query,
    scope,
    roomName,
    filters
  );

  // The field takes focus as the screen opens (autoFocus alone is skipped on
  // some Android versions when the screen mounts inside an overlay).
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const senderName = (hit: MessageSearchHit): string => {
    const room: any = rooms[hit.room];
    const { name, isSelf } = resolveSender(hit, {
      usersSet: usersSet as Record<string, any>,
      members: room?.members as any[],
      myXmppUsername,
    });
    if (isSelf) {return t('search.messages.you');}
    return name || t('search.messages.someone');
  };

  const trimmed = query.trim();

  const renderHit = ({ item: hit }: { item: MessageSearchHit }) => {
    const room: any = rooms[hit.room];
    const reachable = Boolean(resolveHitRoomJid(rooms, hit));
    const title =
      scope === 'all'
        ? `${room?.title || t('search.messages.chat')} · ${senderName(hit)}`
        : senderName(hit);
    return (
      <TouchableOpacity
        testID={`message-search-hit-${hitKey(hit)}`}
        activeOpacity={0.7}
        disabled={!reachable}
        onPress={() =>
          openSearchHit(dispatch as any, rooms, activeRoomJID, hit)
        }
        style={[styles.hit, !reachable && styles.hitDisabled]}
      >
        <View style={styles.hitHead}>
          <Text style={styles.hitTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.hitWhen}>{formatWhen(hit.createdAt, locale)}</Text>
        </View>
        <Text style={styles.snippet} numberOfLines={4}>
          {buildSnippet(hit.body, trimmed).map((part, index) => (
            <Text
              key={index}
              style={
                part.match
                  ? [styles.match, { color: primary, backgroundColor: primary + '1F' }]
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

  const header = (
    <View style={styles.controls}>
      <View style={styles.searchBar}>
        <SearchIcon color={theme.textMuted} />
        <TextInput
          ref={inputRef}
          testID="message-search-input"
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={t(
            scope === 'chat'
              ? 'search.messages.placeholderChat'
              : 'search.messages.placeholderAll'
          )}
          placeholderTextColor={theme.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel={t('search.messages.title')}
        />
      </View>

      <View style={styles.scopeRow} accessibilityLabel={t('search.messages.scope')}>
        {(['chat', 'all'] as SearchScope[]).map((value) => {
          const active = scope === value;
          const disabled = value === 'chat' && !roomName;
          return (
            <TouchableOpacity
              key={value}
              testID={`message-search-scope-${value}`}
              disabled={disabled}
              onPress={() => setScope(value)}
              accessibilityState={{ selected: active, disabled }}
              style={[
                styles.scopeButton,
                active && { borderColor: primary, backgroundColor: primary + '1F' },
                disabled && styles.hitDisabled,
              ]}
            >
              <Text style={[styles.scopeLabel, active && { color: primary }]}>
                {t(
                  value === 'chat'
                    ? 'search.messages.scopeChat'
                    : 'search.messages.scopeAll'
                )}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        testID="message-search-filters-toggle"
        onPress={() => setFiltersOpen((open) => !open)}
        style={styles.filterToggle}
        accessibilityState={{ expanded: filtersOpen }}
      >
        <Text
          style={[
            styles.filterToggleLabel,
            (filtersOpen || activeFilterCount > 0) && { color: primary },
          ]}
        >
          {t('search.messages.filters')}
        </Text>
        {activeFilterCount > 0 && (
          <View style={[styles.badge, { backgroundColor: primary }]}>
            <Text style={styles.badgeText}>{activeFilterCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {filtersOpen && (
        <View style={styles.filterBox}>
          <Text style={styles.fieldLabel}>
            {t('search.messages.filterSender')}
          </Text>
          {sender ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{sender.name}</Text>
              <TouchableOpacity
                testID="message-search-sender-clear"
                accessibilityLabel={t('search.messages.filterClear')}
                onPress={() => setSender(null)}
                hitSlop={8}
              >
                <Text style={styles.chipRemove}>{'×'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TextInput
              testID="message-search-sender-input"
              value={senderQuery}
              onChangeText={setSenderQuery}
              placeholder={t('search.messages.filterSenderPlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={styles.field}
              autoCorrect={false}
            />
          )}
          {!sender &&
            senderCandidates.map((person) => (
              <TouchableOpacity
                key={person.id}
                testID={`message-search-sender-${person.id}`}
                style={styles.suggestion}
                onPress={() => {
                  setSender(person);
                  setSenderQuery('');
                }}
              >
                <Text style={styles.suggestionText}>{person.name}</Text>
              </TouchableOpacity>
            ))}
          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <Text style={styles.fieldLabel}>
                {t('search.messages.filterSince')}
              </Text>
              <TextInput
                testID="message-search-since"
                value={sinceDay}
                onChangeText={setSinceDay}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textMuted}
                style={styles.field}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
            <View style={styles.dateCol}>
              <Text style={styles.fieldLabel}>
                {t('search.messages.filterUntil')}
              </Text>
              <TextInput
                testID="message-search-until"
                value={untilDay}
                onChangeText={setUntilDay}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textMuted}
                style={styles.field}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
          </View>
          {backwards && (
            <Text testID="message-search-date-order" style={styles.error}>
              {t('search.messages.dateOrder')}
            </Text>
          )}
          {activeFilterCount > 0 && (
            <TouchableOpacity
              testID="message-search-clear-filters"
              onPress={clearFilters}
            >
              <Text style={[styles.link, { color: primary }]}>
                {t('search.messages.filterClearAll')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!search.searchable && (
        <Text testID="message-search-hint" style={styles.hint}>
          {trimmed
            ? t('search.messages.tooShort', { count: MIN_QUERY_LENGTH })
            : t('search.messages.hint')}
        </Text>
      )}
      {search.searchable && search.status === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={primary} />
          <Text style={styles.hint}>{t('search.messages.searching')}</Text>
        </View>
      )}
      {search.status === 'error' && (
        <View style={styles.statusRow}>
          <Text testID="message-search-error" style={styles.error}>
            {t('search.messages.error')}
          </Text>
          <TouchableOpacity testID="message-search-retry" onPress={search.retry}>
            <Text style={[styles.link, { color: primary }]}>
              {t('search.messages.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {search.searchable &&
        search.status === 'done' &&
        search.items.length === 0 && (
          <Text testID="message-search-empty" style={styles.hint}>
            {t('search.messages.empty')}
          </Text>
        )}
      {search.items.length > 0 && (
        <Text testID="message-search-count" style={styles.count}>
          {t('search.messages.count', { count: search.total })}
        </Text>
      )}
    </View>
  );

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('search.messages.title')}
      />
      <FlatList
        style={styles.list}
        data={search.items}
        keyExtractor={hitKey}
        renderItem={renderHit}
        ListHeaderComponent={header}
        ListFooterComponent={
          search.items.length > 0 && search.hasMore ? (
            <TouchableOpacity
              testID="message-search-more"
              onPress={search.loadMore}
              disabled={search.status === 'loadingMore'}
              style={[
                styles.more,
                search.status === 'loadingMore' && styles.hitDisabled,
              ]}
            >
              <Text style={styles.scopeLabel}>
                {search.status === 'loadingMore'
                  ? t('search.messages.searching')
                  : t('search.messages.loadMore')}
              </Text>
            </TouchableOpacity>
          ) : null
        }
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={Separator}
      />
    </ModalContainerFullScreen>
  );
};

const createStyles = (theme: ChatTheme) =>
  StyleSheet.create({
    screen: { alignItems: 'stretch' },
    list: { flex: 1, alignSelf: 'stretch' },
    controls: { padding: 16, gap: 12 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      height: 44,
      borderRadius: 12,
      backgroundColor: theme.surfaceSecondary,
    },
    searchInput: { flex: 1, color: theme.text, fontSize: 16, padding: 0 },
    scopeRow: { flexDirection: 'row', gap: 8 },
    scopeButton: {
      flex: 1,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    scopeLabel: { color: theme.textSecondary, fontSize: 14, fontWeight: '500' },
    filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    filterToggleLabel: { color: theme.textSecondary, fontSize: 14 },
    badge: {
      minWidth: 18,
      paddingHorizontal: 5,
      borderRadius: 9,
      alignItems: 'center',
    },
    badgeText: { color: theme.textOnPrimary, fontSize: 12 },
    filterBox: {
      gap: 8,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    fieldLabel: { color: theme.textMuted, fontSize: 12 },
    field: {
      height: 38,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: theme.surfaceSecondary,
      color: theme.text,
      fontSize: 14,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.surfaceSecondary,
    },
    chipText: { color: theme.text, fontSize: 14 },
    chipRemove: { color: theme.textSecondary, fontSize: 18 },
    suggestion: { paddingVertical: 8, paddingHorizontal: 4 },
    suggestionText: { color: theme.text, fontSize: 14 },
    dateRow: { flexDirection: 'row', gap: 8 },
    dateCol: { flex: 1, gap: 4 },
    hint: { color: theme.textMuted, fontSize: 14 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    error: { color: theme.danger, fontSize: 14 },
    link: { fontSize: 14, fontWeight: '500' },
    count: { color: theme.textMuted, fontSize: 12 },
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
    more: {
      alignSelf: 'center',
      marginVertical: 12,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
  });

export default MessageSearchModal;
