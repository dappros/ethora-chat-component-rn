/**
 * Coverage guard for the static UI i18n string tables (src/i18n/strings.ts).
 *
 * The bug this pins: a component hardcodes an English literal instead of
 * calling `useT()`, or a key gets added to `en` but the translator forgets
 * one of the other locale tables, so that locale silently falls back to
 * English for that string. `resolveStringTable` already falls back to `en`
 * for *missing* keys at runtime (so nothing ever renders blank) — this test
 * makes sure that fallback is never actually needed for a key we shipped,
 * by asserting every locale table carries the exact same key set as `en`.
 */

import { BUILTIN_STRINGS, DEFAULT_UI_LANGUAGE } from '../src/i18n/strings';

describe('i18n string table coverage', () => {
  const baseTable = BUILTIN_STRINGS[DEFAULT_UI_LANGUAGE];
  const baseKeys = Object.keys(baseTable).sort();
  const locales = Object.keys(BUILTIN_STRINGS);

  it('has more than one locale registered', () => {
    expect(locales.length).toBeGreaterThan(1);
  });

  it.each(locales.filter((l) => l !== DEFAULT_UI_LANGUAGE))(
    'locale "%s" defines every key present in "en"',
    (locale) => {
      const table = BUILTIN_STRINGS[locale];
      const missing = baseKeys.filter((key) => !(key in table));
      expect(missing).toEqual([]);
    }
  );

  it.each(locales)('locale "%s" has no keys beyond "en" (typo guard)', (locale) => {
    const table = BUILTIN_STRINGS[locale];
    const extra = Object.keys(table)
      .filter((key) => !(key in baseTable))
      .sort();
    expect(extra).toEqual([]);
  });

  it.each(locales)('locale "%s" has no empty string values', (locale) => {
    const table = BUILTIN_STRINGS[locale];
    const empties = Object.entries(table)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key);
    expect(empties).toEqual([]);
  });

  // Keys added while fixing the fr-CA/es-US "some UI strings stay in
  // English" bug report (Attach sheet, chat profile screen, new-message
  // divider, in-app notification sender fallback). Regression guard: these
  // must resolve to a *translated* string (not just exist) in every
  // non-English locale — i.e. the locale's own value must differ from the
  // English one, unless the English text itself is legitimately identical
  // across languages (e.g. proper nouns, or the odd coincidence like "Spam").
  const translationFixKeys = [
    'attach.title',
    'attach.takePhoto',
    'attach.takePhotoHint',
    'attach.photoOrVideo',
    'attach.photoOrVideoHint',
    'attach.document',
    'attach.documentHint',
    'message.newMessages',
    'notification.senderFallback',
    'modal.chatProfile.title',
    'modal.chatProfile.memberListUnavailable',
    'action.unban',
    'action.openSettings',
    'permission.requiredTitle',
    'permission.photoLibrary',
    'toast.successTitle',
    'toast.roomImageUpdated',
    'toast.failedToUploadImage',
    'toast.chatDeletedSuccess',
    'toast.failedToDeleteChat',
  ];

  it.each(translationFixKeys)('key "%s" exists in every locale', (key) => {
    for (const locale of locales) {
      // Keys are flat dotted strings (e.g. "attach.title"), not nested
      // paths — pass as a single-element array so Jest treats the dot as
      // part of the literal key instead of a path separator.
      expect(BUILTIN_STRINGS[locale]).toHaveProperty([key]);
    }
  });

  // Most of these keys' English text isn't a word any of the other locales
  // happen to share (unlike e.g. "Spam" or the French "Document"), so for
  // this subset a same-as-English value really does mean "translator forgot
  // this locale" rather than a legitimate coincidence.
  const mustDifferFromEnglish = translationFixKeys.filter(
    (key) => key !== 'attach.document'
  );

  it.each(
    mustDifferFromEnglish.flatMap((key) =>
      locales
        .filter((l) => l !== DEFAULT_UI_LANGUAGE)
        .map((locale) => [key, locale] as const)
    )
  )('key "%s" is actually translated (not left in English) for "%s"', (key, locale) => {
    expect(BUILTIN_STRINGS[locale][key]).not.toBe(baseTable[key]);
  });
});
