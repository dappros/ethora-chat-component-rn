/** @format */

import type { IConfig } from '../types/types';

/** Ground behind the conversation, and behind the rounded corners of the
 * header and the composer that sit over it. */
export const DEFAULT_CHAT_BACKGROUND = '#F3F6FC';

/**
 * One place for the conversation's background colour.
 *
 * The message list has always painted it; the chat container behind it was
 * plain white, which is what made the header's rounded bottom corners and
 * the composer's rounded top corners invisible — the corners revealed the
 * white parent, not the conversation.
 */
export const getChatBackgroundColor = (config?: IConfig): string =>
  config?.backgroundChat?.color || DEFAULT_CHAT_BACKGROUND;
