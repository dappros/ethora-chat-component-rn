import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSelector } from 'react-redux';
import type { RootState } from '../../roomStore';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useT, useUiLocale } from '../../i18n/useT';
import type { ScheduledCallDetail } from '../../networking/api-requests/scheduledCalls.api';
import type { ScheduledCallCardData } from '../../booking/scheduledCall';
import { scheduledCallUi } from '../../booking/scheduledCallStore';
import {
  canManageScheduledCall,
  confirmAndCancelScheduledCall,
  getScheduledCallDetailCached,
  joinScheduledCall,
  notifyScheduledCall,
} from '../../booking/scheduledCallActions';
import { formatClock } from '../../booking/scheduleForm';
import {
  CalendarButtons,
  PrimaryButton,
  StatePill,
  describeWhen,
  stateLabelKey,
  useBookingStyles,
  useScheduledCallState,
} from './bookingShared';

interface ScheduledCallCardProps {
  card: ScheduledCallCardData;
  roomJid: string;
}

/**
 * The invite card of one scheduled call. Upcoming / joinable / ended /
 * cancelled are decided by getScheduledCallCardState; nothing here starts
 * media, Join is a button the user taps.
 */
export const ScheduledCallCard: React.FC<ScheduledCallCardProps> = ({
  card,
  roomJid,
}) => {
  const t = useT();
  const locale = useUiLocale();
  const { theme } = useBookingStyles();
  const { user, config } = useChatSettingState();
  const joinAllowed = config?.scheduledCalls?.enabled !== false;
  const roomRole = useSelector(
    (state: RootState) => state.rooms.rooms[roomJid]?.role
  );
  const { state, now } = useScheduledCallState(card);
  const live = state === 'upcoming' || state === 'joinable';

  // The invite names its creator, so nobody has to ask the API who may edit.
  // Only an invite that predates `scheduledCallCreatedBy` still looks it up.
  const [fetchedCreator, setFetchedCreator] = useState('');
  const version = `${card.status}|${card.startAt}|${card.durationMinutes}|${card.title}`;
  useEffect(() => {
    if (!live || card.createdBy) {return undefined;}
    let cancelled = false;
    getScheduledCallDetailCached(card.slug, version)
      .then((value) => {
        if (!cancelled) {setFetchedCreator(value.scheduledCall.createdBy || '');}
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [card.slug, card.createdBy, version, live]);

  const canManage =
    live &&
    canManageScheduledCall({
      createdBy: card.createdBy || fetchedCreator,
      userId: user?._id,
      roomRole,
    });

  // Edit needs the whole record (notes, kind); fetch it when it is tapped.
  const editCall = () => {
    getScheduledCallDetailCached(card.slug, version)
      .then((detail: ScheduledCallDetail) =>
        scheduledCallUi.openEdit(roomJid, detail)
      )
      .catch(() => notifyScheduledCall('error', t('booking.error.failed')));
  };

  const dimmed = state === 'ended' || state === 'cancelled';
  const title = card.title || t('call.title');
  const tone =
    state === 'cancelled' ? 'danger' : state === 'joinable' ? 'active' : 'neutral';
  const styles = createCardStyles(theme.surface, theme.border);

  return (
    <View style={styles.wrap}>
      <View
        testID={`scheduled-call-card-${card.slug}`}
        style={[styles.card, dimmed && styles.dimmed]}
      >
        <View style={styles.header}>
          <Text
            testID="scheduled-call-title"
            numberOfLines={2}
            style={[
              styles.title,
              { color: theme.text },
              state === 'cancelled' && styles.struck,
            ]}
          >
            {title}
          </Text>
          <StatePill
            label={t(stateLabelKey(state, card.startMs, now))}
            tone={tone}
          />
        </View>
        <Text
          testID="scheduled-call-when"
          style={[
            styles.when,
            { color: theme.textSecondary },
            state === 'cancelled' && styles.struck,
          ]}
        >
          {describeWhen(card, t, locale)}
        </Text>
        <Text style={[styles.kind, { color: theme.textSecondary }]}>
          {card.kind === 'audio' ? t('call.audioCall') : t('call.videoCall')}
          {card.status === 'updated' && state !== 'cancelled'
            ? ` · ${t('booking.state.updated')}`
            : ''}
        </Text>

        {live && (
          <>
            {joinAllowed && (
              <PrimaryButton
                testID="scheduled-call-join"
                label={t('booking.action.join')}
                disabled={state !== 'joinable'}
                onPress={() => {
                  void joinScheduledCall(roomJid, card.kind);
                }}
              />
            )}
            {joinAllowed && state === 'upcoming' && (
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {t('booking.card.opensAt', {
                  time: formatClock(card.startMs - 15 * 60 * 1000, locale),
                })}
              </Text>
            )}
            <CalendarButtons
              t={t}
              googleUrl={card.googleUrl}
              outlookUrl={card.outlookUrl}
              icsUrl={card.icsUrl}
              testIDPrefix="scheduled-call"
            />
          </>
        )}

        {canManage && (
          <View style={styles.manage}>
            <View style={styles.manageButton}>
              <PrimaryButton
                testID="scheduled-call-edit"
                tone="plain"
                label={t('booking.action.edit')}
                onPress={editCall}
              />
            </View>
            <View style={styles.manageButton}>
              <PrimaryButton
                testID="scheduled-call-cancel"
                tone="plain"
                label={t('booking.action.cancelCall')}
                onPress={() => {
                  void confirmAndCancelScheduledCall(card.slug);
                }}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const createCardStyles = (surface: string, border: string) =>
  StyleSheet.create({
    wrap: { width: '100%', paddingHorizontal: 16, paddingVertical: 6 },
    card: {
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 10,
    },
    dimmed: { opacity: 0.6 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    title: { flex: 1, fontSize: 16, fontWeight: '600' },
    struck: { textDecorationLine: 'line-through' },
    when: { fontSize: 14 },
    kind: { fontSize: 12 },
    hint: { fontSize: 12, textAlign: 'center' },
    manage: { flexDirection: 'row', gap: 8 },
    manageButton: { flex: 1 },
  });

export default ScheduledCallCard;
