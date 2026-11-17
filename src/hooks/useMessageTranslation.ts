import { useEffect, useReducer } from 'react';
import { IMessage } from '../types/types';
import { toBaseLanguage } from '../i18n/strings';
import { msgSortableMs } from '../helpers/msgSortableMs';

/**
 * How long after a message (or its edit) "Translating…" may show for it.
 * The server sends the translation, or word that it failed, within its own
 * cap (90s by default); past this the update was missed (the app was offline
 * then), and the translation comes from the archive with the next history
 * load.
 */
export const TRANSLATION_PENDING_MAX_AGE_MS = 3 * 60_000;

export interface MessageTranslationState {
  /** False when the message is already in the reader's language, or no
   * translation is available — render the plain body, no quote. */
  hasTranslation: boolean;
  /** The server is still translating the message into the reader's
   * language: show "Translating…". Never true with hasTranslation. */
  isPending: boolean;
  /** When isPending stops being true by itself (epoch ms), 0 if never: hand
   * it to useRerenderAt so the label does not outlive it. */
  pendingUntil: number;
  originalText: string;
  /** Translation when hasTranslation, else the original — always safe to
   * render directly. */
  displayText: string;
}

// "42", "+1 (555) 123-4567", "3.14159" — text with no actual letters has
// nothing to translate.
const hasNoLetters = (text: string): boolean => !/\p{L}/u.test(text);

/**
 * Translation for ONE message, into the reader's language only. Ported
 * verbatim from the web SDK (src/hooks/useMessageTranslation.ts).
 *
 * Pure and synchronous — no HTTP call. Every translation this client ever
 * shows arrives over XMPP already: the sender tags outgoing messages with
 * `<translate source="xx"/>` (see sendTextMessageWithTranslateTag) and
 * whatever process attaches actual translations does so server-side,
 * landing on `message.translations` when the stanza is parsed (see
 * getDataFromXml). This function only ever reads that — it never calls a
 * translation service itself, so there's nothing to fail when one isn't
 * reachable, and nothing to await.
 */
export const useMessageTranslation = (
  message: Pick<
    IMessage,
    | 'body'
    | 'langSource'
    | 'translations'
    | 'translationPending'
    | 'translationPendingSince'
    | 'id'
    | 'date'
  >,
  readerLocale?: string,
  enabled = true
): MessageTranslationState => {
  const originalText = message?.body || '';
  const source = message?.langSource;
  const targetBase = toBaseLanguage(readerLocale || 'en');
  const sourceBase = toBaseLanguage(source);

  // Nothing to do when we don't know the source language, the message is
  // already in the reader's language (region ignored: en-US vs en-CA is the
  // same language, not a translation job), or there's no actual text to
  // translate (a bare number, a phone number, an emoji-only reaction).
  const trimmedText = originalText.trim();
  const needsTranslation =
    enabled &&
    !!trimmedText &&
    !!source &&
    sourceBase !== targetBase &&
    !hasNoLetters(trimmedText);

  const result = needsTranslation
    ? message?.translations?.[readerLocale || '']?.translatedText ||
      message?.translations?.[targetBase]?.translatedText
    : undefined;

  // A "translation" that's byte-identical to the original (mistagged
  // langSource, a no-op from the source, matching proper nouns/numbers in
  // otherwise-different text) is worse than nothing: it renders the same
  // sentence twice. Treat identical-after-trim as "nothing to show".
  const isRealTranslation =
    !!result && result.trim() !== originalText.trim();

  // A message the server is still translating (async mode marks the live
  // copy, see getDataFromXml, and an edit, see editRoomMessage): pending
  // until the translation lands, the server says it failed, or the request
  // is too old for it to come live.
  const sentAt = message?.translationPending
    ? message.translationPendingSince || msgSortableMs(message)
    : 0;
  const pendingUntil =
    needsTranslation && !isRealTranslation && sentAt
      ? sentAt + TRANSLATION_PENDING_MAX_AGE_MS
      : 0;

  return {
    hasTranslation: isRealTranslation,
    isPending: pendingUntil > Date.now(),
    pendingUntil,
    originalText,
    displayText: isRealTranslation ? (result as string) : originalText,
  };
};

/**
 * Re-renders the calling component once `at` (epoch ms) has passed; 0 or a
 * past time does nothing. For useMessageTranslation's `pendingUntil`.
 */
export const useRerenderAt = (at: number): void => {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const left = at - Date.now();
    if (!at || left <= 0) {return;}
    const timer = setTimeout(tick, left);
    return () => clearTimeout(timer);
  }, [at]);
};
