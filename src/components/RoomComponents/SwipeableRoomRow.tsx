import React, { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { BellIcon, BellOffIcon, LeaveIcon, ReportIcon } from '../../assets/icons';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import type { ChatTheme } from '../../theme/theme';

/** Width of one action button behind the row. */
export const ROOM_ACTION_WIDTH = 84;

/**
 * Only one row shows its actions at a time, as in the messengers: opening
 * another one, or the list being scrolled, folds the open one back.
 */
let openRow: SwipeableMethods | null = null;

export const closeOpenRoomRow = (): void => {
  openRow?.close();
  openRow = null;
};

interface SwipeableRoomRowProps {
  /** Identifies the row to the host's callbacks. */
  roomJid: string;
  /** The chat's notifications are off: the action offers to turn them on. */
  muted?: boolean;
  /** Mute / unmute, as in the chat profile. No handler → no button. */
  onToggleMute?: (roomJid: string) => void;
  onReport: (roomJid: string) => void;
  onLeave: (roomJid: string) => void;
  children: React.ReactNode;
}

/**
 * A room-list row that slides left to show Mute, Report and Leave behind it,
 * the way chats do in the big messengers. A tap on an action folds the
 * row back first, so the list is tidy under whatever the action opens.
 */
const SwipeableRoomRow: React.FC<SwipeableRoomRowProps> = ({
  roomJid,
  muted = false,
  onToggleMute,
  onReport,
  onLeave,
  children,
}) => {
  const theme = useTheme();
  const t = useT();
  const actionCount = onToggleMute ? 3 : 2;
  const styles = useMemo(
    () => createStyles(theme, actionCount),
    [theme, actionCount]
  );
  const ref = useRef<SwipeableMethods>(null);

  const onWillOpen = useCallback(() => {
    if (openRow && openRow !== ref.current) {openRow.close();}
    openRow = ref.current;
  }, []);
  const onClose = useCallback(() => {
    if (openRow === ref.current) {openRow = null;}
  }, []);

  const act = useCallback(
    (what: (jid: string) => void) => {
      ref.current?.close();
      what(roomJid);
    },
    [roomJid]
  );

  const renderRightActions = useCallback(
    () => (
      <View style={styles.actions}>
        {onToggleMute ? (
          // The ACTION a tap performs, as in the web client: a muted chat
          // (the crossed bell on its row) offers "Unmute" with a plain bell,
          // any other offers "Mute" with the crossed one.
          <TouchableOpacity
            testID={`room-action-mute-${roomJid.split('@')[0]}`}
            accessibilityRole="button"
            accessibilityLabel={t(muted ? 'action.unmute' : 'action.mute')}
            accessibilityState={{ checked: muted }}
            activeOpacity={0.8}
            style={[styles.action, { backgroundColor: theme.icon }]}
            onPress={() => act(onToggleMute)}
          >
            {muted ? (
              <BellIcon color={theme.textOnPrimary} width={22} height={22} />
            ) : (
              <BellOffIcon color={theme.textOnPrimary} width={22} height={22} />
            )}
            <Text style={styles.label}>
              {t(muted ? 'action.unmute' : 'action.mute')}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID={`room-action-report-${roomJid.split('@')[0]}`}
          accessibilityRole="button"
          accessibilityLabel={t('action.report')}
          activeOpacity={0.8}
          style={[styles.action, { backgroundColor: theme.textSecondary }]}
          onPress={() => act(onReport)}
        >
          <ReportIcon color={theme.textOnPrimary} width={22} height={22} />
          <Text style={styles.label}>{t('action.report')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`room-action-leave-${roomJid.split('@')[0]}`}
          accessibilityRole="button"
          accessibilityLabel={t('action.leave')}
          activeOpacity={0.8}
          style={[styles.action, { backgroundColor: theme.danger }]}
          onPress={() => act(onLeave)}
        >
          <LeaveIcon color={theme.textOnPrimary} width={22} height={22} />
          <Text style={styles.label}>{t('action.leave')}</Text>
        </TouchableOpacity>
      </View>
    ),
    [act, muted, onLeave, onReport, onToggleMute, roomJid, styles, t, theme]
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      testID={`room-swipe-${roomJid.split('@')[0]}`}
      friction={2}
      rightThreshold={ROOM_ACTION_WIDTH / 2}
      overshootRight={false}
      enableTrackpadTwoFingerGesture
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={onWillOpen}
      onSwipeableClose={onClose}
      // The row must cover the actions until it moves.
      childrenContainerStyle={{ backgroundColor: theme.listBackground }}
    >
      {children}
    </ReanimatedSwipeable>
  );
};

export default SwipeableRoomRow;

const createStyles = (theme: ChatTheme, actionCount: number) =>
  StyleSheet.create({
    actions: {
      flexDirection: 'row',
      width: ROOM_ACTION_WIDTH * actionCount,
    },
    action: {
      width: ROOM_ACTION_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    label: {
      color: theme.textOnPrimary,
      fontSize: 12,
      fontWeight: '600',
    },
  });
