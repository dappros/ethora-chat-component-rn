import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useT, useUiLocale } from '../../i18n/useT';
import { useTheme } from '../../hooks/useTheme';
import type { ChatTheme } from '../../theme/theme';
import {
  createScheduledCall,
  updateScheduledCall,
} from '../../networking/api-requests/scheduledCalls.api';
import {
  scheduledCallUi,
  useScheduledCallUi,
  type EditorState,
} from '../../booking/scheduledCallStore';
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_CHOICES,
  NOTES_MAX,
  TIME_STEP_MINUTES,
  TITLE_MAX,
  clampDuration,
  defaultStartMs,
  deviceTimezone,
  formatClock,
  formatDay,
  shiftDays,
  shiftMinutes,
  validateStart,
} from '../../booking/scheduleForm';
import { chatNameOfRoom } from '../../booking/scheduledCall';
import {
  invalidateScheduledCallDetail,
  notifyScheduledCall,
} from '../../booking/scheduledCallActions';
import { BookingSheet, PrimaryButton } from './bookingShared';

type Kind = 'video' | 'audio';

const Stepper: React.FC<{
  label: string;
  value: string;
  onBack: () => void;
  onForward: () => void;
  backLabel: string;
  forwardLabel: string;
  testID: string;
  theme: ChatTheme;
}> = ({ label, value, onBack, onForward, backLabel, forwardLabel, testID, theme }) => (
  <View>
    <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
    <View style={[styles.stepper, { backgroundColor: theme.surfaceSecondary }]}>
      <TouchableOpacity
        testID={`${testID}-back`}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        onPress={onBack}
        hitSlop={8}
        style={styles.stepperButton}
      >
        <Text style={[styles.stepperGlyph, { color: theme.primary }]}>{'<'}</Text>
      </TouchableOpacity>
      <Text testID={`${testID}-value`} style={[styles.stepperValue, { color: theme.text }]}>
        {value}
      </Text>
      <TouchableOpacity
        testID={`${testID}-forward`}
        accessibilityRole="button"
        accessibilityLabel={forwardLabel}
        onPress={onForward}
        hitSlop={8}
        style={styles.stepperButton}
      >
        <Text style={[styles.stepperGlyph, { color: theme.primary }]}>{'>'}</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  theme: ChatTheme;
}> = ({ label, selected, onPress, testID, theme }) => (
  <TouchableOpacity
    testID={testID}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    activeOpacity={0.8}
    style={[
      styles.chip,
      {
        borderColor: selected ? theme.primary : theme.border,
        backgroundColor: selected ? theme.primary + '1A' : 'transparent',
      },
    ]}
  >
    <Text
      style={{
        color: selected ? theme.primary : theme.text,
        fontSize: 13,
        fontWeight: '500',
      }}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const Form: React.FC<{ editor: EditorState }> = ({ editor }) => {
  const t = useT();
  const locale = useUiLocale();
  const theme = useTheme();
  const { config } = useChatSettingState();
  const existing = editor.mode === 'edit' ? editor.detail.scheduledCall : null;

  const [title, setTitle] = useState(existing?.title || '');
  const [notes, setNotes] = useState(existing?.description || '');
  const [startMs, setStartMs] = useState(() =>
    existing ? Date.parse(existing.startAt) : defaultStartMs(Date.now())
  );
  const [duration, setDuration] = useState(
    existing?.durationMinutes || DEFAULT_DURATION_MINUTES
  );
  const [kind, setKind] = useState<Kind>(existing?.kind || 'video');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio is its own opt-in on the call buttons; the schedule follows it.
  const audioAllowed =
    config?.videoCalls?.enableAudioCalls === true || kind === 'audio';

  const submit = async () => {
    if (busy) {return;}
    const problem = validateStart(startMs, Date.now(), {
      allowPast: editor.mode === 'edit',
    });
    if (problem === 'pastTime') {
      setError(t('booking.error.pastTime'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: title.trim() || t('call.title'),
        description: notes.trim(),
        startAt: new Date(startMs).toISOString(),
        durationMinutes: clampDuration(duration),
        kind,
      };
      if (editor.mode === 'edit') {
        await updateScheduledCall(editor.detail.scheduledCall.slug, payload);
        invalidateScheduledCallDetail(editor.detail.scheduledCall.slug);
        notifyScheduledCall('success', t('booking.toast.updated'));
      } else {
        await createScheduledCall({
          ...payload,
          chatName: chatNameOfRoom(editor.roomJid),
          timezone: deviceTimezone(),
        });
        notifyScheduledCall('success', t('booking.toast.scheduled'));
      }
      scheduledCallUi.closeEditor();
    } catch (failure: any) {
      setError(
        failure?.serverCode === 'START_IN_PAST'
          ? t('booking.error.pastTime')
          : t('booking.error.save')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {t('booking.field.title')}
        </Text>
        <TextInput
          testID="schedule-call-title"
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
          placeholder={t('call.title')}
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceSecondary, color: theme.text },
          ]}
        />
      </View>

      <Stepper
        testID="schedule-call-date"
        label={t('booking.field.date')}
        value={formatDay(startMs, locale)}
        onBack={() => setStartMs((v) => shiftDays(v, -1))}
        onForward={() => setStartMs((v) => shiftDays(v, 1))}
        backLabel={t('booking.a11y.previousDay')}
        forwardLabel={t('booking.a11y.nextDay')}
        theme={theme}
      />
      <Stepper
        testID="schedule-call-time"
        label={t('booking.field.time')}
        value={formatClock(startMs, locale)}
        onBack={() => setStartMs((v) => shiftMinutes(v, -TIME_STEP_MINUTES))}
        onForward={() => setStartMs((v) => shiftMinutes(v, TIME_STEP_MINUTES))}
        backLabel={t('booking.a11y.earlier')}
        forwardLabel={t('booking.a11y.later')}
        theme={theme}
      />

      <View>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {t('booking.field.duration')}
        </Text>
        <View style={styles.chips}>
          {DURATION_CHOICES.map((minutes) => (
            <Chip
              key={minutes}
              testID={`schedule-call-duration-${minutes}`}
              label={t('booking.duration.minutes', { n: minutes })}
              selected={duration === minutes}
              onPress={() => setDuration(minutes)}
              theme={theme}
            />
          ))}
        </View>
      </View>

      {audioAllowed && (
        <View>
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            {t('booking.field.kind')}
          </Text>
          <View style={styles.chips}>
            <Chip
              testID="schedule-call-kind-video"
              label={t('call.videoCall')}
              selected={kind === 'video'}
              onPress={() => setKind('video')}
              theme={theme}
            />
            <Chip
              testID="schedule-call-kind-audio"
              label={t('call.audioCall')}
              selected={kind === 'audio'}
              onPress={() => setKind('audio')}
              theme={theme}
            />
          </View>
        </View>
      )}

      <View>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {t('booking.field.notes')}
        </Text>
        <TextInput
          testID="schedule-call-notes"
          value={notes}
          onChangeText={setNotes}
          maxLength={NOTES_MAX}
          multiline
          placeholder={t('booking.field.notesPlaceholder')}
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            styles.notes,
            { backgroundColor: theme.surfaceSecondary, color: theme.text },
          ]}
        />
      </View>

      {error && (
        <Text testID="schedule-call-error" style={{ color: theme.danger }}>
          {error}
        </Text>
      )}

      <PrimaryButton
        testID="schedule-call-submit"
        label={
          editor.mode === 'edit'
            ? t('booking.action.save')
            : t('booking.action.create')
        }
        onPress={() => {
          void submit();
        }}
        busy={busy}
      />
    </>
  );
};

/** The schedule / edit sheet. Lives in ScheduledCallHost. */
export const ScheduleCallSheet: React.FC = () => {
  const { editor } = useScheduledCallUi();
  const t = useT();
  // Keep the last editor while the modal fades so the form does not blank.
  const [shown, setShown] = useState<EditorState | null>(editor);
  useEffect(() => {
    if (editor) {setShown(editor);}
  }, [editor]);
  const formKey = useMemo(
    () =>
      shown
        ? shown.mode === 'edit'
          ? `edit:${shown.detail.scheduledCall.slug}`
          : `create:${shown.roomJid}`
        : 'none',
    [shown]
  );
  if (!shown) {return null;}
  return (
    <BookingSheet
      visible={!!editor}
      onClose={scheduledCallUi.closeEditor}
      title={
        shown.mode === 'edit'
          ? t('booking.sheet.editTitle')
          : t('booking.sheet.createTitle')
      }
      testID="schedule-call-sheet"
    >
      {/* A fresh form per call, so reopening never shows the last values. */}
      {editor && <Form key={formKey} editor={editor} />}
    </BookingSheet>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  notes: { minHeight: 72, textAlignVertical: 'top' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
  },
  stepperButton: {
    width: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperGlyph: { fontSize: 20, fontWeight: '600' },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '500',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
