import type { IMentionSpan } from '../types/models/message.model';
import { normalizeCaptionInput } from '../helpers/caption';

/** What a sealed media <body> carries besides the keys. */
export interface SealedMediaPayload {
  keys: string[];
  /** The text typed with the files. Sealed here, never on <data>. */
  caption?: string;
  captionMentions?: IMentionSpan[];
}

/**
 * Pulls the attachment keys (and the caption, when there is one) out of a
 * decrypted media <body>: `{v:1,keys:[...],caption?,captionMentions?}`, which
 * the sender writes in place of the usual literal "media". Undefined for
 * anything else, so an ordinary media message falls through untouched.
 */
export function parseSealedMediaPayload(
  body?: string
): SealedMediaPayload | undefined {
  const text = String(body || '').trim();
  if (!text.startsWith('{')) {return undefined;}

  try {
    const parsed = JSON.parse(text) as {
      v?: unknown;
      keys?: unknown;
      caption?: unknown;
      captionMentions?: unknown;
    };
    if (parsed?.v !== 1 || !Array.isArray(parsed.keys)) {return undefined;}
    const keys = parsed.keys.filter(
      (k): k is string => typeof k === 'string' && k.length > 0
    );
    if (!(keys.length === parsed.keys.length && keys.length > 0)) {
      return undefined;
    }

    const caption = normalizeCaptionInput({
      text: typeof parsed.caption === 'string' ? parsed.caption : '',
      mentions: parsed.captionMentions as IMentionSpan[] | undefined,
    });
    return {
      keys,
      ...(caption ? { caption: caption.caption } : {}),
      ...(caption?.mentions ? { captionMentions: caption.mentions } : {}),
    };
  } catch {
    return undefined;
  }
}

/** The attachment keys out of a sealed media <body>; see parseSealedMediaPayload. */
export function parseSealedMediaBody(body?: string): string[] | undefined {
  return parseSealedMediaPayload(body)?.keys;
}
