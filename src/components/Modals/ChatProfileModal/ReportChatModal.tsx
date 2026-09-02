/** @format */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSelector } from 'react-redux';
import { getActiveRoom, RootState } from '../../../roomStore';
import { postReportRoom } from '../../../networking/api-requests/rooms.api';
import { useToast } from '../../../context/ToastContext';
import { useT } from '../../../i18n/useT';
import { getIconColor } from '../../../helpers/getIconColor';
import { useChatSettingState } from '../../../hooks/useChatSettingState';

/**
 * Category ids go to `POST /v1/chats/reports/{chatName}` as-is; the labels
 * come from the i18n table, which already carried `report.category.*`
 * strings in all six locales with nothing rendering them until now.
 */
const CATEGORIES = [
  'spam',
  'violence',
  'childAbuse',
  'pornography',
  'personalDetails',
  'illegalDrugs',
  'other',
] as const;

interface ReportChatModalProps {
  visible: boolean;
  onClose: () => void;
}

const ReportChatModal: React.FC<ReportChatModalProps> = ({
  visible,
  onClose,
}) => {
  const t = useT();
  const { showToast } = useToast();
  const { config } = useChatSettingState();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));
  const [category, setCategory] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const primary = getIconColor(config);

  const close = () => {
    setCategory(null);
    setDetails('');
    onClose();
  };

  const submit = async () => {
    if (!category || sending) {return;}
    setSending(true);
    try {
      await postReportRoom({
        chatName: activeRoom?.jid?.split('@')[0] || '',
        category,
        text: details.trim() || undefined,
      });
      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: t('modal.report.chatTitle'),
        type: 'success',
      });
      close();
    } catch (error) {
      console.error('Failed to report chat:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: t('modal.report.chatTitle'),
        type: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          testID="report-backdrop"
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={close}
        />
        <View style={styles.card}>
          <Text style={styles.title}>{t('modal.report.chatTitle')}</Text>
          <View style={styles.categories}>
            {CATEGORIES.map((id) => {
              const selected = category === id;
              return (
                <TouchableOpacity
                  key={id}
                  testID={`report-category-${id}`}
                  activeOpacity={0.7}
                  onPress={() => setCategory(id)}
                  style={[
                    styles.category,
                    selected && { borderColor: primary, backgroundColor: primary + '14' },
                  ]}
                >
                  <Text
                    style={[styles.categoryLabel, selected && { color: primary }]}
                  >
                    {t(`report.category.${id}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {category === 'other' && (
            <TextInput
              testID="report-details"
              style={styles.input}
              placeholder={t('modal.report.otherDetails')}
              placeholderTextColor="#8C8C8C"
              value={details}
              onChangeText={setDetails}
              multiline
            />
          )}
          <View style={styles.buttons}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.button, styles.cancel]}
              onPress={close}
            >
              <Text style={styles.cancelLabel}>{t('action.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="report-submit"
              activeOpacity={0.7}
              disabled={!category || sending}
              style={[
                styles.button,
                { backgroundColor: primary, opacity: !category || sending ? 0.5 : 1 },
              ]}
              onPress={submit}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitLabel}>{t('action.send')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,15,20,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#141414',
    marginBottom: 16,
  },
  categories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  category: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E4E4E9',
  },
  categoryLabel: {
    fontSize: 14,
    color: '#141414',
  },
  input: {
    marginTop: 16,
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E9',
    padding: 12,
    fontSize: 14,
    color: '#141414',
    textAlignVertical: 'top',
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
    backgroundColor: '#F2F2F7',
  },
  cancelLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#141414',
  },
  submitLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default ReportChatModal;
