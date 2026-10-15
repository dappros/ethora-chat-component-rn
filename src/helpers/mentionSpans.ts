import type { IMentionSpan } from '../types/models/message.model';

/**
 * Keeps only the spans that still read "@Name" at their offset in `text`.
 * RN does not render mentions; a caption's spans are stored (and checked) so
 * they survive a round trip to a client that does.
 */
export const validateMentionSpans = (
  text: string,
  spans: IMentionSpan[]
): IMentionSpan[] =>
  spans.filter((span) => {
    if (span.offset < 0 || span.offset + span.length > text.length) {
      return false;
    }
    return text.slice(span.offset, span.offset + span.length) === `@${span.name}`;
  });
