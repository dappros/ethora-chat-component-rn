import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSelector } from 'react-redux';
import type { RootState } from '../../roomStore';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useT, useUiLocale } from '../../i18n/useT';
import {
  scheduledCallUi,
  useScheduledCallUi,
  type PreJoinState,
} from '../../booking/scheduledCallStore';
import {
  JOIN_WINDOW_BEFORE_MS,
  chatNameOfRoom,
  type ScheduledCallCardData,
} from '../../booking/scheduledCall';
import {
  canManageScheduledCall,
  confirmAndCancelScheduledCall,
  joinScheduledCall,
} from '../../booking/scheduledCallActions';
import { formatClock } from '../../booking/scheduleForm';
import {
  BookingSheet,
  CalendarButtons,
  PrimaryButton,
  StatePill,
  describeWhen,
  stateLabelKey,
  useBookingStyles,
  useScheduledCallState,
} from './bookingShared';

const ERROR_KEYS = {
  'not-a-member': 'booking.error.notMember',
  'not-found': 'booking.error.notFound',
  cancelled: 'booking.error.cancelled',
  network: 'booking.error.failed',
} as const;

const Ready: React.FC<{
  detail: Extract<PreJoinState, { phase: 'ready' }>['detail'];
}> = ({ detail }) => {
  const t = useT();
  const locale = useUiLocale();
  const { theme } = useBookingStyles();
  const { user, config } = useChatSettingState();
  const scheduledCalls = config?.scheduledCalls;
  const call = detail.scheduledCall;
  const roomJid = detail.chat?.jid || call.chatName;
  const roomRole = useSelector(
    (state: RootState) =>
      Object.values(state.rooms.rooms).find(
        (room) => chatNameOfRoom(room?.jid || '') === chatNameOfRoom(roomJid)
      )?.role
  );

  const card: ScheduledCallCardData = {
    slug: call.slug,
    title: call.title,
    startAt: call.startAt,
    startMs: Date.parse(call.startAt),
    durationMinutes: call.durationMinutes,
    kind: call.kind === 'audio' ? 'audio' : 'video',
    status: call.status === 'cancelled' ? 'cancelled' : 'scheduled',
    joinUrl: detail.links.join,
    icsUrl: detail.links.ics || '',
    googleUrl: detail.links.google || '',
    outlookUrl: detail.links.outlook || '',
    createdBy: call.createdBy || '',
  };
  const { state, now } = useScheduledCallState(card);
  const [joining, setJoining] = useState(false);
  const joinAllowed = scheduledCalls?.enabled !== false;

  const canManage =
    (state === 'upcoming' || state === 'joinable') &&
    canManageScheduledCall({
      createdBy: call.createdBy,
      userId: user?._id,
      roomRole,
    });

  return (
    <>
      <View style={styles.row}>
        <Text
          testID="prejoin-title"
          style={[styles.callTitle, { color: theme.text }]}
          numberOfLines={3}
        >
          {call.title || t('call.title')}
        </Text>
        <StatePill
          label={t(stateLabelKey(state, card.startMs, now))}
          tone={state === 'joinable' ? 'active' : 'neutral'}
        />
      </View>
      <Text testID="prejoin-when" style={{ color: theme.textSecondary, fontSize: 14 }}>
        {describeWhen(card, t, locale)}
      </Text>
      <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
        {card.kind === 'audio' ? t('call.audioCall') : t('call.videoCall')}
      </Text>
      {!!call.description && (
        <Text style={{ color: theme.text, fontSize: 14 }}>{call.description}</Text>
      )}

      {joinAllowed && (
        <PrimaryButton
          testID="prejoin-join"
          label={t('booking.action.join')}
          disabled={state !== 'joinable'}
          busy={joining}
          onPress={() => {
            setJoining(true);
            joinScheduledCall(roomJid, card.kind)
              .then((started) => {
                if (started) {scheduledCallUi.closePreJoin();}
              })
              .finally(() => setJoining(false));
          }}
        />
      )}
      <Text style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}>
        {state === 'upcoming'
          ? t('booking.prejoin.joinFrom', {
              time: formatClock(card.startMs - JOIN_WINDOW_BEFORE_MS, locale),
            })
          : t('booking.prejoin.hint')}
      </Text>

      {(state === 'upcoming' || state === 'joinable') && (
        <CalendarButtons
          t={t}
          googleUrl={card.googleUrl}
          outlookUrl={card.outlookUrl}
          icsUrl={card.icsUrl}
          testIDPrefix="prejoin"
        />
      )}

      {canManage && (
        <View style={styles.row}>
          <View style={styles.half}>
            <PrimaryButton
              testID="prejoin-edit"
              tone="plain"
              label={t('booking.action.edit')}
              onPress={() => {
                scheduledCallUi.closePreJoin();
                scheduledCallUi.openEdit(roomJid, detail);
              }}
            />
          </View>
          <View style={styles.half}>
            <PrimaryButton
              testID="prejoin-cancel"
              tone="plain"
              label={t('booking.action.cancelCall')}
              onPress={() => {
                void confirmAndCancelScheduledCall(call.slug).then((done) => {
                  if (done) {scheduledCallUi.closePreJoin();}
                });
              }}
            />
          </View>
        </View>
      )}
    </>
  );
};

/**
 * The pre-join screen of a call opened from a link or a reminder: what the
 * call is, and a Join button. Nothing is started until Join is tapped.
 */
export const ScheduledCallPreJoin: React.FC = () => {
  const { preJoin } = useScheduledCallUi();
  const t = useT();
  const { theme } = useBookingStyles();
  // Hold the last content while the modal fades out.
  const [shown, setShown] = useState<PreJoinState | null>(preJoin);
  useEffect(() => {
    if (preJoin) {setShown(preJoin);}
  }, [preJoin]);
  if (!shown) {return null;}

  return (
    <BookingSheet
      visible={!!preJoin}
      onClose={scheduledCallUi.closePreJoin}
      title={t('booking.prejoin.title')}
      testID="prejoin-sheet"
    >
      {shown.phase === 'loading' && (
        <Text testID="prejoin-loading" style={{ color: theme.textSecondary }}>
          {t('call.connecting')}
        </Text>
      )}
      {shown.phase === 'error' && (
        <>
          {shown.title ? (
            <Text style={{ color: theme.text, fontWeight: '600', fontSize: 16 }}>
              {shown.title}
            </Text>
          ) : null}
          <Text testID="prejoin-error" style={{ color: theme.danger, fontSize: 15 }}>
            {t(ERROR_KEYS[shown.reason])}
          </Text>
          <PrimaryButton
            testID="prejoin-close"
            tone="plain"
            label={t('booking.action.close')}
            onPress={scheduledCallUi.closePreJoin}
          />
        </>
      )}
      {shown.phase === 'ready' && <Ready detail={shown.detail} />}
    </BookingSheet>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  callTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
  half: { flex: 1 },
});

export default ScheduledCallPreJoin;
