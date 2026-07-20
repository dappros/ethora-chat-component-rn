import { Iso639_1Codes } from '../../types/types';

type LanguageOption = {
  name: string;
  id: Iso639_1Codes;
};

/**
 * Languages the in-chat globe picker offers.
 *
 * Names are AUTONYMS (each language written in itself), which is what
 * every mainstream language picker does: a reader who only speaks French
 * can find "Français" but not "French". Ids carry the region because the
 * deployment's readers are Canadian and US, and the region is forwarded to
 * the translation service so it can tell fr-CA from fr-FR. Base-language
 * lookups (i18n tables, Translate-button visibility) strip it via
 * toBaseLanguage, so both forms interoperate.
 *
 * Commented-out entries still have full string tables in i18n/strings.ts,
 * they're just not offered to readers in the current deployment.
 */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { name: 'English', id: 'en-CA' },
  { name: 'Español', id: 'es-US' },
  { name: 'Français', id: 'fr-CA' },
  // { name: 'Português', id: 'pt' },
  // { name: 'Kreyòl ayisyen', id: 'ht' },
  // { name: '中文', id: 'zh' },
];
