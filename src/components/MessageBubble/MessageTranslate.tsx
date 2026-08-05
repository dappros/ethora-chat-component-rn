import React, { FC, useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IConfig, IMessage } from '../../types/types';
import { CustomDivider } from './CustomDivider';
import { CustomMessageText } from '../styled/StyledComponents';
import { useT } from '../../i18n/useT';
import { toBaseLanguage } from '../../i18n/strings';
import { useMessageTranslation } from '../../hooks/useMessageTranslation';

interface MessageTranslateProps {
  message: IMessage;
  isUser: boolean;
  config?: IConfig;
  /**
   * The reader's target language, resolved ONCE by the parent (Message.tsx)
   * and shared with auto mode, so the two can never ask for different
   * languages.
   */
  readerLocale?: string;
}

type HostPhase = 'idle' | 'loading' | 'done' | 'error';

/**
 * Manual-mode message translation (LinkedIn-style "Translate" link).
 *
 * Manual is AUTO BEHIND A TAP — the same translation, revealed on press,
 * not a second mechanism. Both read what the stanza already carries on
 * `message.translations`; neither calls a translation service.
 *
 * That is enforced by sharing `useMessageTranslation` with auto rather than
 * re-deriving the lookup here. The previous copy (ported verbatim from web,
 * which still has it) drifted in two ways that both pointed the same
 * direction — a link that could not deliver:
 *
 *   - its target language ended at the literal `'en'` instead of the
 *     reader's own `langSource`, so for every host that lets the reader
 *     pick — the normal case — a French reader's tap asked the message for
 *     an ENGLISH translation and fell into `translation.failed`;
 *   - it offered the link on a source-vs-target language compare alone,
 *     without checking a translation was actually attached, so even with
 *     the right locale a never-translated message showed a dead link.
 *
 * The link now appears only when there is something to reveal, which makes
 * the failure state unreachable on this path.
 *
 * A host-supplied `config.translates.onTranslate` is the one asynchronous
 * case: it can produce a translation nothing on the stanza predicts, so
 * there the link is offered on the language compare and loading/error still
 * apply.
 */
const MessageTranslate: FC<MessageTranslateProps> = ({
  message,
  isUser,
  config,
  readerLocale,
}) => {
  const t = useT();
  const translates = config?.translates;
  const hasHostTranslator = typeof translates?.onTranslate === 'function';

  const originalText = String(message?.body || '');
  const sourceLocale = (message as { langSource?: string })?.langSource;
  const targetLocale =
    readerLocale || translates?.readerLocale || config?.i18n?.locale || 'en';

  // The exact call auto mode makes, with the exact same locale.
  const attached = useMessageTranslation(message, targetLocale, true);

  const [revealed, setRevealed] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [hostPhase, setHostPhase] = useState<HostPhase>('idle');
  const [hostText, setHostText] = useState<string | null>(null);
  const linkColor = config?.colors?.primary || '#0052CD';

  // Region ignored on purpose: en-US vs en-CA is the same language, not a
  // translation job. The FULL locale is still what `onTranslate` receives.
  const languagesDiffer =
    !!originalText.trim() &&
    !!sourceLocale &&
    toBaseLanguage(sourceLocale) !== toBaseLanguage(targetLocale);

  const shouldShow = (() => {
    if (isUser) {
      return false;
    }
    // A host that supplies this keeps the locale logic and just tells us
    // yes/no.
    if (typeof translates?.showTranslateForMessage === 'function') {
      return translates.showTranslateForMessage(message);
    }
    // Host translator: the outcome isn't knowable until it runs.
    if (hasHostTranslator) {
      return languagesDiffer;
    }
    // Stanza-attached: only offer what we can actually deliver.
    return attached.hasTranslation;
  })();

  const runHostTranslate = useCallback(async () => {
    if (!originalText.trim()) {
      return;
    }
    setHostPhase('loading');
    try {
      const result = await translates?.onTranslate?.(originalText, {
        sourceLocale,
        targetLocale,
        message,
      });
      if (result && result.trim()) {
        setHostText(result);
        setHostPhase('done');
      } else {
        setHostPhase('error');
      }
    } catch {
      setHostPhase('error');
    }
  }, [originalText, translates, sourceLocale, targetLocale, message]);

  if (!shouldShow) {
    return null;
  }

  const renderLink = (label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} hitSlop={6}>
      <Text style={[styles.link, { color: linkColor }]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderRevealed = (translatedText: string) => (
    <View>
      <CustomDivider
        configColor={
          isUser ? config?.colors?.secondary : config?.colors?.primary
        }
      />
      <CustomMessageText colorUser="">
        {showOriginal ? originalText : translatedText}
      </CustomMessageText>
      {renderLink(
        showOriginal ? t('action.translate') : t('action.showOriginal'),
        () => setShowOriginal((v) => !v)
      )}
    </View>
  );

  // Host-provided translator: asynchronous, and can genuinely fail.
  if (hasHostTranslator) {
    if (hostPhase === 'loading') {
      return (
        <Text style={[styles.link, { color: linkColor }]}>
          {t('translation.translating')}
        </Text>
      );
    }
    if (hostPhase === 'error') {
      return renderLink(t('translation.failed'), runHostTranslate);
    }
    if (hostPhase === 'done' && hostText) {
      return renderRevealed(hostText);
    }
    return renderLink(t('action.translate'), runHostTranslate);
  }

  // Stanza-attached: nothing to await, nothing to fail.
  if (!revealed) {
    return renderLink(t('action.translate'), () => setRevealed(true));
  }
  return renderRevealed(attached.displayText);
};

const styles = StyleSheet.create({
  link: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
  },
});

export default MessageTranslate;
