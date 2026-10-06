import React, { useCallback, useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTheme } from '../../../hooks/useTheme';
import { useT } from '../../../i18n/useT';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import {
  appLanguageChoices,
  chatLanguageChoices,
  setAppLanguage,
  setChatLanguage,
  type LanguageChoice,
} from '../../../services/languageSettings';

interface LanguageCardProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The user's two languages: the interface, and what messages are translated
 * into. See services/languageSettings for what each one does and where it
 * is kept.
 */
const LanguageCard: React.FC<LanguageCardProps> = ({ style, testID }) => {
  const theme = useTheme();
  const t = useT();
  const { config, langSource, uiLocale } = useChatSettingState();

  const appChoices = useMemo(() => appLanguageChoices(config), [config]);
  const chatChoices = useMemo(() => chatLanguageChoices(config), [config]);
  const appCurrent = uiLocale || config?.i18n?.locale || '';
  // Unset follows the interface language - the backend's own rule.
  const chatCurrent = langSource || appCurrent;

  const pick = useCallback(
    (kind: 'app' | 'chat', id: string) => {
      void (kind === 'app' ? setAppLanguage(id) : setChatLanguage(id));
    },
    []
  );

  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const group = (
    kind: 'app' | 'chat',
    label: string,
    hint: string,
    choices: LanguageChoice[],
    current: string
  ) => (
    <View style={styles.group}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text>
      <View style={styles.pills} accessibilityRole="radiogroup">
        {choices.map((choice) => {
          const selected = same(choice.id, current);
          return (
            <TouchableOpacity
              key={choice.id}
              testID={`settings-language-${kind}-${choice.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              activeOpacity={0.7}
              onPress={() => pick(kind, choice.id)}
              style={[
                styles.pill,
                {
                  borderColor: selected ? theme.primary : theme.border,
                  backgroundColor: selected ? theme.primary : theme.surfaceSecondary,
                },
              ]}
            >
              <Text
                style={[
                  styles.pillLabel,
                  { color: selected ? theme.textOnPrimary : theme.text },
                ]}
              >
                {choice.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={[style, styles.card]} testID={testID || 'settings-languages'}>
      {group(
        'app',
        t('settings.language.app'),
        t('settings.language.appHint'),
        appChoices,
        appCurrent
      )}
      {group(
        'chat',
        t('settings.language.chat'),
        t('settings.language.chatHint'),
        chatChoices,
        chatCurrent
      )}
    </View>
  );
};

export default LanguageCard;

const styles = StyleSheet.create({
  // Applied over the host's card style: its surface, this layout.
  card: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
  },
  group: {
    gap: 6,
  },
  label: {
    fontSize: 17,
    fontWeight: '500',
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
