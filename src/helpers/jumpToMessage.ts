import type { IMessage } from '../types/types';

// How far apart the archive's timestamp and the transcript's may be for the
// same message. They are recorded by different components, so they are not
// identical, but never more than a moment apart.
export const CONTENT_MATCH_WINDOW_MS = 5000;

/**
 * Index of the message a jump names.
 *
 * By id first (message.id is the MAM stanza id for history, xmppId the client
 * message id). When the request has no id at all, which is common for archive
 * rows, by content: same text, sent within a few seconds of the same time.
 */
export const findMessageIndex = (
  messages: IMessage[],
  ids: string[],
  content?: { createdAt?: string; body?: string }
): number => {
  if (ids.length > 0) {
    const byId = messages.findIndex(
      (message) =>
        ids.includes(String(message.id)) ||
        (message.xmppId ? ids.includes(String(message.xmppId)) : false)
    );
    if (byId >= 0) {return byId;}
  }

  if (!content?.createdAt || !content.body) {return -1;}
  const wanted = new Date(content.createdAt).getTime();
  if (Number.isNaN(wanted)) {return -1;}
  const body = content.body.trim();
  return messages.findIndex((message) => {
    if (String(message.body ?? '').trim() !== body) {return false;}
    return (
      Math.abs(new Date(message.date).getTime() - wanted) <=
      CONTENT_MATCH_WINDOW_MS
    );
  });
};

export const MAX_SCROLL_RETRIES = 4;

/**
 * FlatList only knows the position of rows it has measured, so
 * scrollToIndex fails for a row far from the rendered window. The usual
 * remedy: scroll to an estimated offset (which renders that region), then
 * try scrollToIndex again. Returns the offset to estimate to, or null once
 * the retry budget is spent.
 */
export const scrollRetryOffset = (
  info: { index: number; averageItemLength: number },
  attempt: number
): number | null => {
  if (attempt >= MAX_SCROLL_RETRIES) {return null;}
  return Math.max(0, info.averageItemLength * info.index);
};
