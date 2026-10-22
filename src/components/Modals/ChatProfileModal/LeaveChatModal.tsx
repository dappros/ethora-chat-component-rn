/** @format */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../roomStore';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import { useLeaveRoom } from '../../../hooks/useLeaveRoom';
import { useFileToken } from '../../../hooks/useFileToken';
import { appendFileToken } from '../../../helpers/secureFileUrl';
import { useTheme } from '../../../hooks/useTheme';
import { useT } from '../../../i18n/useT';
import type { ChatTheme } from '../../../theme/theme';

interface LeaveChatModalProps {
  /** The room to leave; the modal is shown while this is set. */
  roomJid: string | null;
  onClose: () => void;
  /** Called after the server took us out, before the modal closes. */
  onLeft?: (jid: string) => void;
}

/**
 * Telegram-style confirmation in front of every Leave: the chat's avatar and
 * name, the question, Cancel and a red Leave. The leave itself runs here, so
 * the card stays up with a spinner until the server answers and a failure is
 * reported over it instead of after it has gone.
 */
const LeaveChatModal: React.FC<LeaveChatModalProps> = ({
  roomJid,
  onClose,
  onLeft,
}) => {
  const t = useT();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fileToken = useFileToken();
  const leaveRoom = useLeaveRoom();
  const room = useSelector((state: RootState) =>
    roomJid ? state.rooms.rooms?.[roomJid] : undefined
  );
  const [leaving, setLeaving] = useState(false);

  const name = room?.title || room?.name || '';

  const close = () => {
    if (!leaving) {onClose();}
  };

  const confirm = async () => {
    if (!roomJid || leaving) {return;}
    setLeaving(true);
    const ok = await leaveRoom(roomJid);
    setLeaving(false);
    if (!ok) {
      Alert.alert(t('toast.error'), t('toast.leaveFailed'));
      return;
    }
    onLeft?.(roomJid);
    onClose();
  };

  return (
    <Modal
      transparent
      visible={roomJid !== null}
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          testID="leave-backdrop"
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={close}
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <ProfileImagePlaceholder
              name={name}
              size={40}
              icon={appendFileToken(room?.icon, fileToken)}
              disableOverlay
            />
            <Text style={styles.title} numberOfLines={1}>
              {t('modal.leaveChat.title')}
            </Text>
          </View>
          <Text style={styles.description}>
            {name
              ? t('modal.leaveChat.descriptionNamed', { name })
              : t('modal.leaveChat.description')}
          </Text>
          <View style={styles.buttons}>
            <TouchableOpacity
              testID="leave-cancel"
              activeOpacity={0.7}
              disabled={leaving}
              style={[styles.button, styles.cancel]}
              onPress={close}
            >
              <Text style={styles.cancelLabel}>{t('action.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="leave-confirm"
              activeOpacity={0.7}
              disabled={leaving}
              style={[styles.button, { backgroundColor: theme.danger }]}
              onPress={confirm}
            >
              {leaving ? (
                <ActivityIndicator color={theme.textOnPrimary} />
              ) : (
                <Text style={styles.leaveLabel}>{t('action.leave')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (theme: ChatTheme) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    backgroundColor: theme.surface,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: theme.text,
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    color: theme.text,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    backgroundColor: theme.surfaceSecondary,
  },
  cancelLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.text,
  },
  leaveLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.textOnPrimary,
  },
});

export default LeaveChatModal;
