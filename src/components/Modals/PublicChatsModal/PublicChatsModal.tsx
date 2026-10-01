/** @format */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { setCurrentRoom } from '../../../roomStore/roomsSlice';
import { setActiveModal } from '../../../roomStore/chatSettingsSlice';
import {
  getPublicChats,
  PublicChat,
} from '../../../networking/api-requests/publicChats.api';
import { ModalContainerFullScreen } from '../styledModalComponents';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import { SearchIcon } from '../../../assets/icons';
import { useT } from '../../../i18n/useT';
import { useTheme } from '../../../hooks/useTheme';
import { useFileToken } from '../../../hooks/useFileToken';
import { appendFileToken } from '../../../helpers/secureFileUrl';
import { getIconColor } from '../../../helpers/getIconColor';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import type { ChatTheme } from '../../../theme/theme';
import { filterPublicChats, publicChatJid } from './publicChatsLogic';

interface PublicChatsModalProps {
  handleCloseModal: () => void;
}

/**
 * A directory of the app's public chats (GET /v1/chats/public), so finding a
 * chat to join no longer needs someone to hand over a link or a QR code.
 *
 * Joining reuses what a shared link or QR code already does: selecting a room
 * you are not in makes the room initialiser join it and refresh the room
 * list, and ChatRoom shows a loader meanwhile (see joiningRoomJID).
 */
const PublicChatsModal: React.FC<PublicChatsModalProps> = ({
  handleCloseModal,
}) => {
  const t = useT();
  const dispatch = useDispatch();
  const theme = useTheme();
  const fileToken = useFileToken();
  const { config } = useChatSettingState();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const primary = getIconColor(config);

  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const conference = useSelector(
    (state: RootState) =>
      state.chatSettingStore.config?.xmppSettings?.conference
  );

  const [items, setItems] = useState<PublicChat[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [status, setStatus] = useState<
    'loading' | 'loadingMore' | 'done' | 'error'
  >('loading');
  const [filter, setFilter] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(async (offset: number) => {
    const id = ++requestRef.current;
    setStatus(offset ? 'loadingMore' : 'loading');
    try {
      const page = await getPublicChats({ offset });
      if (id !== requestRef.current) {return;}
      setItems((prev) => {
        const seen = new Set(prev.map((chat) => chat.name));
        return offset
          ? [...prev, ...page.items.filter((c) => !seen.has(c.name))]
          : page.items;
      });
      setTotal(page.total);
      setNextOffset(page.nextOffset);
      setStatus('done');
    } catch {
      if (id === requestRef.current) {setStatus('error');}
    }
  }, []);

  useEffect(() => {
    load(0);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const joined = useMemo(
    () => new Set(Object.keys(rooms).map((jid) => jid.split('@')[0])),
    [rooms]
  );
  const visible = useMemo(() => filterPublicChats(items, filter), [items, filter]);

  const open = (chat: PublicChat) => {
    const roomJID = publicChatJid(chat, conference);
    if (!roomJID) {return;}
    dispatch(setCurrentRoom({ roomJID }));
    dispatch(setActiveModal(undefined));
  };

  const hasMore = nextOffset < total;
  const idle = status !== 'loading' && status !== 'error';

  const renderItem = ({ item: chat }: { item: PublicChat }) => {
    const isJoined = joined.has(chat.name);
    return (
      <View style={styles.row}>
        <ProfileImagePlaceholder
          name={chat.title || chat.name}
          icon={chat.picture ? appendFileToken(chat.picture, fileToken) : null}
          size={40}
        />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {chat.title || t('search.messages.chat')}
          </Text>
          {!!chat.description && (
            <Text style={styles.description} numberOfLines={2}>
              {chat.description}
            </Text>
          )}
        </View>
        <TouchableOpacity
          testID={`public-chat-${chat.name}`}
          onPress={() => open(chat)}
          style={[
            styles.action,
            isJoined
              ? { borderColor: theme.border }
              : { backgroundColor: primary, borderColor: primary },
          ]}
        >
          <Text
            style={[
              styles.actionLabel,
              { color: isJoined ? theme.textSecondary : theme.textOnPrimary },
            ]}
          >
            {t(isJoined ? 'publicChats.open' : 'publicChats.join')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const header = (
    <View style={styles.controls}>
      <View style={styles.searchBar}>
        <SearchIcon color={theme.textMuted} />
        <TextInput
          testID="public-chats-filter"
          value={filter}
          onChangeText={setFilter}
          placeholder={t('publicChats.filter')}
          placeholderTextColor={theme.textMuted}
          style={styles.searchInput}
          autoCorrect={false}
          accessibilityLabel={t('publicChats.filter')}
        />
      </View>
      {status === 'loading' && (
        <View testID="public-chats-loading" style={styles.statusRow}>
          <ActivityIndicator color={primary} />
          <Text style={styles.hint}>{t('publicChats.loading')}</Text>
        </View>
      )}
      {status === 'error' && (
        <View style={styles.statusRow}>
          <Text testID="public-chats-error" style={styles.error}>
            {t('publicChats.error')}
          </Text>
          <TouchableOpacity
            testID="public-chats-retry"
            onPress={() => load(nextOffset)}
          >
            <Text style={[styles.link, { color: primary }]}>
              {t('search.messages.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {idle && visible.length === 0 && (
        <Text testID="public-chats-empty" style={styles.hint}>
          {filter.trim() && hasMore
            ? t('publicChats.emptyFilterMore')
            : t('publicChats.empty')}
        </Text>
      )}
    </View>
  );

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('publicChats.title')}
      />
      <FlatList
        style={styles.list}
        data={visible}
        keyExtractor={(chat) => chat.name}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={
          hasMore && idle ? (
            <TouchableOpacity
              testID="public-chats-more"
              onPress={() => load(nextOffset)}
              disabled={status === 'loadingMore'}
              style={[styles.more, status === 'loadingMore' && styles.dim]}
            >
              <Text style={styles.moreLabel}>
                {status === 'loadingMore'
                  ? t('search.messages.searching')
                  : t('search.messages.loadMore')}
              </Text>
            </TouchableOpacity>
          ) : null
        }
        keyboardShouldPersistTaps="handled"
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
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    hint: { color: theme.textMuted, fontSize: 14 },
    error: { color: theme.danger, fontSize: 14 },
    link: { fontSize: 14, fontWeight: '500' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    text: { flex: 1, gap: 2 },
    title: { color: theme.text, fontSize: 16, fontWeight: '600' },
    description: { color: theme.textSecondary, fontSize: 13 },
    action: {
      minWidth: 64,
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
    },
    actionLabel: { fontSize: 14, fontWeight: '500' },
    more: {
      alignSelf: 'center',
      marginVertical: 12,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    moreLabel: { color: theme.textSecondary, fontSize: 14, fontWeight: '500' },
    dim: { opacity: 0.6 },
  });

export default PublicChatsModal;
