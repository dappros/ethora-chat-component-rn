import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ModalContainerFullScreen } from '../../styledModalComponents';
import ModalHeaderComponent from '../../ModalHeaderComponent';
import { ProfileImagePlaceholder } from '../../../MainComponents/ProfileImagePlaceholder';
import { getBlockedUsers, type BlockedUser } from '../../../../networking/api-requests/rooms.api';
import { useBlockUser } from '../../../../hooks/useBlockUser';
import { useChatSettingState } from '../../../../hooks/useChatSettingState';
import { useFileToken } from '../../../../hooks/useFileToken';
import { appendFileToken } from '../../../../helpers/secureFileUrl';
import { chatTextStyle } from '../../../../helpers/typography';
import { useT } from '../../../../i18n/useT';
import { useTheme } from '../../../../hooks/useTheme';
import type { ChatTheme } from '../../../../theme/theme';

interface BlockedUsersModalProps {
  handleCloseModal: any;
}

/** Settings → Blocked users: who the user blocked, with Unblock (config.features.userBlock) */
const BlockedUsersModal: React.FC<BlockedUsersModalProps> = ({ handleCloseModal }) => {
  const t = useT();
  const { config } = useChatSettingState();
  const fileToken = useFileToken();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { unblock } = useBlockUser();

  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBlockedUsers()
      .then((list) => alive && setUsers(list))
      .catch(() => {
        if (!alive) {return;}
        setFailed(true);
        setUsers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleUnblock = useCallback(
    async (blocked: BlockedUser) => {
      const peer = blocked.xmppUsername || blocked._id;
      if (!peer || busyId) {return;}
      setBusyId(blocked._id);
      if (await unblock(peer)) {
        setUsers((list) => (list || []).filter((u) => u._id !== blocked._id));
      }
      setBusyId(null);
    },
    [unblock, busyId]
  );

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.blockedUsers.title')}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.hint}>{t('settings.blockedUsers.hint')}</Text>
        {users === null ? (
          <ActivityIndicator color={theme.primary} style={styles.loader} />
        ) : users.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.empty}>
              {failed ? t('settings.blockedUsers.loadFailed') : t('settings.blockedUsers.emptyState')}
            </Text>
          </View>
        ) : (
          users.map((blocked) => {
            const name =
              [blocked.firstName, blocked.lastName].filter(Boolean).join(' ') ||
              t('message.blockedUserName');
            const image = appendFileToken(blocked.profileImage, fileToken);
            return (
              <View key={blocked._id} style={styles.card} testID={`blocked-user-${blocked._id}`}>
                {image ? (
                  <Image source={{ uri: image }} style={styles.avatar} />
                ) : (
                  <ProfileImagePlaceholder name={name} size={40} />
                )}
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  disabled={!!busyId}
                  onPress={() => void handleUnblock(blocked)}
                  style={styles.unblock}
                  accessibilityRole="button"
                >
                  {busyId === blocked._id ? (
                    <ActivityIndicator color={theme.primary} />
                  ) : (
                    <Text style={styles.unblockText}>{t('action.unblock')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    </ModalContainerFullScreen>
  );
};

const createStyles = (theme: ChatTheme) =>
  StyleSheet.create({
    screen: { backgroundColor: theme.listBackground },
    scroll: { flex: 1, width: '100%' },
    body: { padding: 12, gap: 12 },
    hint: { fontSize: 13, color: theme.textSecondary, paddingHorizontal: 8 },
    loader: { marginTop: 24 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.surface,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    avatar: { width: 40, height: 40, borderRadius: 20 },
    name: { flex: 1, fontSize: 16, fontWeight: '500', color: theme.text },
    empty: { fontSize: 15, color: theme.textSecondary },
    unblock: { paddingHorizontal: 12, paddingVertical: 8, minWidth: 80, alignItems: 'center' },
    unblockText: { fontSize: 15, fontWeight: '600', color: theme.primary },
  });

export default BlockedUsersModal;
