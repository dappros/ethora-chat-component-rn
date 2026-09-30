/** @format */

import React, { useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { ModalContainerFullScreen } from '../styledModalComponents';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { ArowDownIcon } from '../../../assets/icons';
import {
  setActiveModal,
  setPushEnabled,
  setThemePreference,
} from '../../../roomStore/chatSettingsSlice';
import type { RootState } from '../../../roomStore';
import { MODAL_TYPES } from '../../../helpers/constants/MODAL_TYPES';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { chatTextStyle } from '../../../helpers/typography';
import { savePreferences } from '../../../helpers/preferencesStorage';
import { useT } from '../../../i18n/useT';
import { useTheme } from '../../../hooks/useTheme';
import type { ChatTheme, ThemePreference } from '../../../theme/theme';

interface UserSettingsModalProps {
  handleCloseModal: any;
}

const APPEARANCES: ThemePreference[] = ['light', 'dark', 'system'];

const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  handleCloseModal,
}) => {
  const t = useT();
  const dispatch = useDispatch();
  const { config } = useChatSettingState();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const themePreference = useSelector(
    (s: RootState) => s.chatSettingStore.themePreference
  );
  const pushEnabled = useSelector(
    (s: RootState) => s.chatSettingStore.pushEnabled
  );

  // What the picker shows before the user ever touched it: the host's
  // config.dark, so the selected segment matches what is on screen.
  const appearance: ThemePreference =
    themePreference ??
    (config?.dark === 'system' ? 'system' : config?.dark ? 'dark' : 'light');

  const appearanceLabels: Record<ThemePreference, string> = useMemo(
    () => ({
      light: t('settings.appearance.light'),
      dark: t('settings.appearance.dark'),
      system: t('settings.appearance.system'),
    }),
    [t]
  );

  const options = useMemo(
    () => [
      { label: t('settings.manageData.title'), key: MODAL_TYPES.MANAGE_DATA },
      { label: t('settings.visibility.title'), key: MODAL_TYPES.VISIBILITY },
    ],
    [t]
  );

  const handleClick = useCallback(
    (key: string) => {
      dispatch(setActiveModal(key as any));
    },
    [dispatch]
  );

  const handleAppearance = useCallback(
    (pref: ThemePreference) => {
      dispatch(setThemePreference(pref));
      savePreferences({ theme: pref });
    },
    [dispatch]
  );

  // The SDK acts on the flag itself (pushRegistration releases / restores
  // the device-token registrations); the host is told so it can mirror
  // the choice on any native push side it owns.
  const onPushNotificationsToggle = config?.eventHandlers?.onPushNotificationsToggle;
  const handlePush = useCallback(
    (enabled: boolean) => {
      dispatch(setPushEnabled(enabled));
      savePreferences({ pushEnabled: enabled });
      if (onPushNotificationsToggle) {
        Promise.resolve(onPushNotificationsToggle(enabled)).catch((err) =>
          console.warn('[settings] onPushNotificationsToggle failed', err)
        );
      }
    },
    [dispatch, onPushNotificationsToggle]
  );

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.menu.title')}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
      />
      {/* One card per entry, rather than a single bordered block with
        * hairline dividers — the rows are separate destinations, and the
        * design gives each its own surface. */}
      <View style={styles.body}>
        {!config?.settings?.hideAppearance ? (
          <View style={[styles.card, styles.stackCard]} testID="settings-appearance">
            <Text style={styles.label}>{t('settings.appearance.title')}</Text>
            <View style={styles.segmented} accessibilityRole="radiogroup">
              {APPEARANCES.map((pref) => {
                const selected = pref === appearance;
                return (
                  <TouchableOpacity
                    key={pref}
                    testID={`settings-appearance-${pref}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    activeOpacity={0.7}
                    style={[styles.segment, selected && styles.segmentSelected]}
                    onPress={() => handleAppearance(pref)}
                  >
                    <Text
                      style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}
                    >
                      {appearanceLabels[pref]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {!config?.settings?.hidePushToggle ? (
          <View style={styles.card} testID="settings-notifications">
            <View style={styles.switchText}>
              <Text style={styles.label}>{t('settings.notifications.push')}</Text>
              <Text style={styles.hint}>{t('settings.notifications.pushHint')}</Text>
            </View>
            <Switch
              testID="settings-push-switch"
              value={pushEnabled !== false}
              onValueChange={handlePush}
              trackColor={{ true: theme.primary, false: theme.surfaceSecondary }}
              thumbColor={theme.surface}
              ios_backgroundColor={theme.surfaceSecondary}
            />
          </View>
        ) : null}

        {options.map((option) => (
          <TouchableOpacity
            key={option.key}
            testID={`settings-row-${option.key}`}
            activeOpacity={0.7}
            style={styles.card}
            onPress={() => handleClick(option.key)}
          >
            <Text style={styles.label}>{option.label}</Text>
            <ArowDownIcon
              color={theme.textSecondary}
              width={20}
              height={20}
              style={styles.chevron}
            />
          </TouchableOpacity>
        ))}
      </View>
    </ModalContainerFullScreen>
  );
};

const createStyles = (theme: ChatTheme) => StyleSheet.create({
  screen: {
    backgroundColor: theme.listBackground,
  },
  body: {
    width: '100%',
    padding: 12,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 22,
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  // Label above the control instead of beside it: three segments do not
  // fit next to a label on narrow phones.
  stackCard: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 14,
  },
  label: {
    fontSize: 17,
    fontWeight: '500',
    color: theme.text,
  },
  hint: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: theme.textSecondary,
  },
  switchText: {
    flex: 1,
    paddingRight: 16,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  segmentSelected: {
    backgroundColor: theme.surface,
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.textSecondary,
  },
  segmentLabelSelected: {
    color: theme.text,
  },
  chevron: {
    transform: [{ rotate: '-90deg' }],
  },
});

export default UserSettingsModal;
