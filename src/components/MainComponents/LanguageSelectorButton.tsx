import React, { FC, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { getIconColor } from '../../helpers/getIconColor';
import { useT } from '../../i18n/useT';
import { GlobeIcon, LanguageSelectorModal } from './LanguageSelectorModal';

/**
 * Globe button in the chat header that opens the reader's language picker.
 *
 * Renders only when translation is on. A host that drives the reader's
 * language from its own settings screen (via `config.translates
 * .readerLocale`) can hide this with `showLanguageSelector: false` rather
 * than shipping two competing controls.
 */
export const LanguageSelectorButton: FC = () => {
  const { config } = useChatSettingState();
  const t = useT();
  const [open, setOpen] = useState(false);

  const translates = config?.translates;
  const enabled = Boolean(translates?.enabled || config?.enableTranslates);
  if (!enabled || translates?.showLanguageSelector === false) {
    return null;
  }

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('language.select')}
        onPress={() => setOpen(true)}
        style={styles.button}
        hitSlop={8}
      >
        <GlobeIcon color={getIconColor(config)} size={22} />
      </TouchableOpacity>
      <LanguageSelectorModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default LanguageSelectorButton;
