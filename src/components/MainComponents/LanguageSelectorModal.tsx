import React, { FC, useCallback } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useDispatch } from 'react-redux';
import {
  setLangSource,
  setTranslateMode,
} from '../../roomStore/chatSettingsSlice';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { LANGUAGE_OPTIONS } from '../../helpers/constants/LANGUAGE_OPTIONS';
import { Iso639_1Codes } from '../../types/models/language.model';
import {
  canReaderChooseTranslateMode,
  resolveTranslateMode,
} from '../../utils/translateModePolicy';
import { useT } from '../../i18n/useT';
import { toBaseLanguage } from '../../i18n/strings';
import { getIconColor } from '../../helpers/getIconColor';

const TEXT_PRIMARY = '#141414';
const TEXT_MUTED = '#8C8C8C';
const DIVIDER = '#F0F0F0';

export const GlobeIcon: FC<{ color?: string; size?: number }> = ({
  color = '#0052CD',
  size = 22,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.8} />
    <Path
      d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"
      stroke={color}
      strokeWidth={1.8}
      fill="none"
    />
  </Svg>
);

/**
 * The reader's language control.
 *
 * One switch drives two things on purpose: the language messages get
 * translated INTO, and (through useT falling back to `langSource`) the
 * language the interface itself is in. A reader who picks Français expects
 * the whole chat in French, not French messages inside an English UI.
 *
 * The auto/manual switcher only renders when the host hasn't pinned
 * `config.translates.forceType`, and the language list only when
 * `showLanguageList` isn't false, for hosts that drive the reader's
 * language from their own settings screen via `readerLocale`.
 */
export const LanguageSelectorModal: FC<{
  visible: boolean;
  onClose: () => void;
}> = ({ visible, onClose }) => {
  const dispatch = useDispatch();
  const t = useT();
  const { config, langSource, translateMode } = useChatSettingState();

  const translates = config?.translates;
  const effectiveMode = resolveTranslateMode(translates, translateMode);
  const showModeSwitcher = canReaderChooseTranslateMode(translates);
  const showLanguageList = translates?.showLanguageList !== false;
  const activeLocale = translates?.readerLocale || langSource;

  const selectLanguage = useCallback(
    (id: Iso639_1Codes) => {
      dispatch(setLangSource(id));
      onClose();
    },
    [dispatch, onClose]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Backdrop closes on tap; the card swallows the press so a tap
          inside it doesn't dismiss. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{t('language.select')}</Text>

          {showModeSwitcher && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                {t('translation.modeLabel')}
              </Text>
              <View style={styles.segmented}>
                {(['auto', 'manual'] as const).map((mode) => {
                  const selected = effectiveMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => dispatch(setTranslateMode(mode))}
                      style={[
                        styles.segment,
                        selected && styles.segmentSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          selected && styles.segmentTextSelected,
                        ]}
                      >
                        {mode === 'auto'
                          ? t('translation.modeAuto')
                          : t('translation.modeManual')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {showLanguageList && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('language.select')}</Text>
              <ScrollView style={styles.list}>
                {LANGUAGE_OPTIONS.map((option) => {
                  // Compare on the base language so a reader on "fr" still
                  // sees "Français" (id fr-CA) ticked.
                  const selected =
                    !!activeLocale &&
                    toBaseLanguage(activeLocale) === toBaseLanguage(option.id);
                  return (
                    <TouchableOpacity
                      key={option.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => selectLanguage(option.id)}
                      style={styles.listRow}
                    >
                      <Text
                        style={[
                          styles.listRowText,
                          selected && styles.listRowTextSelected,
                        ]}
                      >
                        {option.name}
                      </Text>
                      {selected && (
                        <Text
                          style={[
                            styles.check,
                            { color: getIconColor(config) },
                          ]}
                        >
                          ✓
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: getIconColor(config) }]}>
              {t('action.cancel')}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 18,
    color: TEXT_PRIMARY,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: '#F5F7F9',
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentSelected: {
    backgroundColor: '#fff',
  },
  segmentText: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  segmentTextSelected: {
    color: TEXT_PRIMARY,
    fontWeight: '600',
  },
  list: {
    maxHeight: 260,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  listRowText: {
    fontSize: 16,
    color: TEXT_PRIMARY,
  },
  listRowTextSelected: {
    fontWeight: '600',
  },
  check: {
    fontSize: 16,
  },
  closeButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  closeText: {
    fontSize: 15,
  },
});

export default LanguageSelectorModal;
