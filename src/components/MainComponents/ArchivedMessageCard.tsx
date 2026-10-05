import React, { useEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { clearArchivedMessage } from '../../roomStore/roomsSlice';
import { useT } from '../../i18n/useT';
import { useTheme } from '../../hooks/useTheme';

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {return '';}
  try {
    return date.toLocaleString();
  } catch {
    return date.toISOString();
  }
};

/**
 * The message a search hit points at, shown when the transcript cannot reach
 * it (the search archive is deeper than the chat's own history). It sits over
 * the conversation of the room it came from, so it needs no navigation and
 * says what the message is instead of reporting that it was not found.
 */
const ArchivedMessageCard: React.FC<{ roomJID: string }> = ({ roomJID }) => {
  const t = useT();
  const theme = useTheme();
  const dispatch = useDispatch();
  const message = useSelector(
    (state: RootState) => state.rooms.archivedMessage
  );
  const visible = Boolean(message && message.roomJID === roomJID);

  // Gone with the conversation it belongs to.
  useEffect(
    () => () => {
      dispatch(clearArchivedMessage());
    },
    [dispatch]
  );

  if (!visible || !message) {return null;}

  const close = () => dispatch(clearArchivedMessage());

  return (
    <Pressable
      testID="archived-message-card"
      style={[styles.scrim, { backgroundColor: theme.overlay }]}
      onPress={close}
      accessibilityRole="button"
      accessibilityLabel={t('action.close')}
    >
      {/* A tap on the card itself must not close it (text stays selectable). */}
      <Pressable
        style={[
          styles.card,
          { backgroundColor: theme.surface, shadowColor: theme.shadow },
        ]}
        onPress={() => undefined}
        accessibilityRole="alert"
        accessibilityLabel={t('search.messages.archivedTitle')}
      >
        <View>
          <Text style={[styles.sender, { color: theme.text }]}>
            {message.sender}
          </Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {formatWhen(message.createdAt)}
          </Text>
        </View>
        <ScrollView
          style={[styles.bodyBox, { backgroundColor: theme.surfaceSecondary }]}
        >
          <Text selectable style={[styles.body, { color: theme.text }]}>
            {message.body}
          </Text>
        </ScrollView>
        <Text style={[styles.note, { color: theme.textSecondary }]}>
          {t('search.messages.archivedNote')}
        </Text>
        <Pressable
          testID="archived-message-close"
          onPress={close}
          style={[styles.close, { borderColor: theme.border }]}
          accessibilityRole="button"
        >
          <Text style={{ color: theme.text }}>{t('action.close')}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '100%',
    padding: 16,
    borderRadius: 16,
    gap: 12,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  sender: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12 },
  bodyBox: { padding: 12, borderRadius: 12, maxHeight: 280 },
  body: { fontSize: 14, lineHeight: 21 },
  note: { fontSize: 12 },
  close: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 999,
  },
});

export default ArchivedMessageCard;
