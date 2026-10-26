import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { ChatTheme } from '../../theme/theme';
import {
  MAX_TIMER_MS,
  getScheduledCallCardState,
  nextScheduledCallTransition,
  type ScheduledCallCardData,
  type ScheduledCallCardState,
} from '../../booking/scheduledCall';
import { openBackendLink } from '../../booking/scheduledCallActions';
import { formatClock, formatDay } from '../../booking/scheduleForm';

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The card's state, re-evaluated when it changes on its own (the join
 * window opens, the call ends) instead of on a poll.
 */
export const useScheduledCallState = (
  card: Pick<
    ScheduledCallCardData,
    'startMs' | 'durationMinutes' | 'status'
  >
): { state: ScheduledCallCardState; now: number } => {
  const [now, setNow] = useState(() => Date.now());
  const { startMs, durationMinutes, status } = card;

  useEffect(() => {
    setNow(Date.now());
  }, [startMs, durationMinutes, status]);

  useEffect(() => {
    const at = nextScheduledCallTransition(
      { startMs, durationMinutes, status },
      now
    );
    if (at === null) {return undefined;}
    // A timer can fire a hair early; the +50 ms keeps the re-check past it.
    const wait = Math.min(MAX_TIMER_MS, Math.max(1000, at - Date.now() + 50));
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [startMs, durationMinutes, status, now]);

  return { state: getScheduledCallCardState(card, now), now };
};

export const stateLabelKey = (
  state: ScheduledCallCardState,
  startMs: number,
  now: number
): string => {
  switch (state) {
    case 'cancelled':
      return 'booking.state.cancelled';
    case 'ended':
      return 'booking.state.ended';
    case 'joinable':
      return now >= startMs
        ? 'booking.state.inProgress'
        : 'booking.state.startingSoon';
    default:
      return 'booking.state.upcoming';
  }
};

export const describeWhen = (
  card: Pick<ScheduledCallCardData, 'startMs' | 'durationMinutes'>,
  t: T,
  locale?: string
): string =>
  `${t('booking.card.starts', {
    date: formatDay(card.startMs, locale),
    time: formatClock(card.startMs, locale),
  })} · ${t('booking.duration.minutes', { n: card.durationMinutes })}`;

export const useBookingStyles = () => {
  const theme = useTheme();
  return useMemo(() => ({ theme, styles: createStyles(theme) }), [theme]);
};

export const StatePill: React.FC<{
  label: string;
  tone: 'neutral' | 'active' | 'danger';
}> = ({ label, tone }) => {
  const { theme, styles } = useBookingStyles();
  const color =
    tone === 'active'
      ? theme.success
      : tone === 'danger'
        ? theme.danger
        : theme.textSecondary;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
};

/** Add to Google / Outlook / .ics: the backend's links, opened as they are. */
export const CalendarButtons: React.FC<{
  t: T;
  googleUrl?: string;
  outlookUrl?: string;
  icsUrl?: string;
  testIDPrefix?: string;
}> = ({ t, googleUrl, outlookUrl, icsUrl, testIDPrefix = 'booking' }) => {
  const { theme, styles } = useBookingStyles();
  const items: Array<[string, string, string | undefined]> = [
    ['google', 'booking.calendar.google', googleUrl],
    ['outlook', 'booking.calendar.outlook', outlookUrl],
    ['ics', 'booking.calendar.ics', icsUrl],
  ];
  const available = items.filter(([, , url]) => !!url);
  if (available.length === 0) {return null;}
  return (
    <View>
      <Text style={styles.sectionLabel}>{t('booking.calendar.add')}</Text>
      <View style={styles.calendarRow}>
        {available.map(([id, labelKey, url]) => (
          <TouchableOpacity
            key={id}
            testID={`${testIDPrefix}-calendar-${id}`}
            accessibilityRole="link"
            activeOpacity={0.7}
            onPress={() => {
              void openBackendLink(url);
            }}
            style={[styles.calendarButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.calendarLabel, { color: theme.primary }]}>
              {t(labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

/** Bottom sheet shell shared by the editor and the pre-join sheet. */
export const BookingSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  testID?: string;
  children: React.ReactNode;
}> = ({ visible, onClose, title, testID, children }) => {
  const { styles } = useBookingStyles();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          testID={testID ? `${testID}-backdrop` : undefined}
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.sheet} testID={testID}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetBody}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export const PrimaryButton: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'primary' | 'danger' | 'plain';
  testID?: string;
}> = ({ label, onPress, disabled, busy, tone = 'primary', testID }) => {
  const { theme, styles } = useBookingStyles();
  const background =
    tone === 'primary'
      ? theme.primary
      : tone === 'danger'
        ? theme.danger
        : theme.surfaceSecondary;
  const color = tone === 'plain' ? theme.text : theme.textOnPrimary;
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      activeOpacity={0.8}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.buttonText, { color }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

export const createStyles = (theme: ChatTheme) =>
  StyleSheet.create({
    pill: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    pillText: { fontSize: 11, fontWeight: '600' },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textSecondary,
      marginBottom: 6,
    },
    calendarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    calendarButton: {
      borderWidth: 1,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    calendarLabel: { fontSize: 13, fontWeight: '500' },
    backdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 24,
      maxHeight: '90%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.divider,
      marginBottom: 12,
    },
    sheetTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 12,
    },
    sheetBody: { gap: 14, paddingBottom: 8 },
    button: {
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    buttonText: { fontSize: 15, fontWeight: '600' },
  });
