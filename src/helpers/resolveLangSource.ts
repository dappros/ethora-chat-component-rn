import { IConfig, Iso639_1Codes } from '../types/types';

/**
 * Legacy single-locale config (`translates.translations`) seeds langSource
 * only when the host ACTUALLY set it.
 *
 * The condition used to be inverted (`!translates.translations`), so merely
 * enabling translation fired `setLangSource(undefined)` on every XMPP init
 * and wiped whatever the reader had picked from the globe — the language
 * reset itself on every reconnect. Web fixed this; RN had not.
 */
export const resolveLegacyTranslatesLangSource = (
  translatesConfig?: IConfig['translates']
): Iso639_1Codes | undefined =>
  translatesConfig?.enabled && translatesConfig?.translations
    ? translatesConfig.translations
    : undefined;

/**
 * A host drives the reader's language from OUTSIDE the component by setting
 * `config.translates.readerLocale` (their own language switcher, or the
 * testbed's Setup tab). Nothing was syncing it into `langSource`, so pinning
 * it only redirected the incoming-translation lookup: the UI captions and
 * the `<translate source>` on outgoing messages both kept following the
 * unset `langSource`.
 *
 * Unlike web this keeps the FULL locale rather than the base language. RN's
 * LANGUAGE_OPTIONS are region-tagged (`es-US`, `fr-CA`) because the region
 * is forwarded to the translation service, and the in-chat picker stores
 * that full form — so the external path has to store the same thing or the
 * two would disagree. Caption lookups strip to the base themselves.
 *
 * Resolves only when actually set, so a host that leaves it unset never
 * clobbers what the reader chose for themselves.
 */
export const resolveExternalReaderLocaleLangSource = (
  readerLocale?: string
): Iso639_1Codes | undefined =>
  (readerLocale || undefined) as Iso639_1Codes | undefined;

