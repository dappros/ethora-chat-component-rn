interface Translation {
  translatedText: string;
  language: string;
  languageName: string;
}
export interface TranslationObject {
  [language: string]: Translation;
}
export const transformArrayToObject = (
  array: Translation[]
): TranslationObject => {
  return array.reduce((acc, item) => {
    acc[item.language] = item;
    return acc;
  }, {} as TranslationObject);
};

/**
 * Namespace of mod_translate's own elements: `<translation-pending/>` on the
 * live copy of a message whose translation is still running (async mode),
 * and `<translation-update/>` that carries it afterwards.
 */
export const TRANSLATE_NS = 'ethora:translate';

// Keep only well-formed translation entries (drops partial/garbage items),
// same shape guard the web SDK applies before transformArrayToObject.
const normalizeTranslations = (value: unknown): Translation[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Translation =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as any).translatedText === 'string' &&
          typeof (item as any).language === 'string' &&
          typeof (item as any).languageName === 'string'
      )
    : [];

/**
 * The JSON the translation service returns (`{"translates":[...]}`), as
 * carried by `<translations value=...>` and `<translation-update value=...>`,
 * keyed by language. Undefined for a missing value; a malformed one yields
 * an empty object rather than throwing, so it can never drop the stanza.
 */
export const parseTranslationsValue = (
  value: unknown
): TranslationObject | undefined => {
  if (typeof value !== 'string' || !value) {return undefined;}
  let payload: { translates?: unknown } = {};
  try {
    payload = JSON.parse(value) || {};
  } catch {
    payload = {};
  }
  return transformArrayToObject(normalizeTranslations(payload.translates));
};
