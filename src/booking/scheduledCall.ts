import { msgSortableMs } from '../helpers/msgSortableMs';
import type { IMessage } from '../types/types';

/**
 * Scheduled-call invite cards: what a `<data type="scheduledCall">` message
 * says, and the pure rules for which message owns a card and what state the
 * card is in. No React, no store: everything here is unit-testable.
 */

export const SCHEDULED_CALL_MESSAGE_TYPE = 'scheduledCall';

/** Join opens this long before the start (contract: 15 minutes). */
export const JOIN_WINDOW_BEFORE_MS = 15 * 60 * 1000;

export type ScheduledCallMessageStatus = 'scheduled' | 'updated' | 'cancelled';

/** upcoming -> joinable (15 min before start until the end) -> ended; or cancelled. */
export type ScheduledCallCardState =
  | 'upcoming'
  | 'joinable'
  | 'ended'
  | 'cancelled';

export interface ScheduledCallCardData {
  slug: string;
  title: string;
  /** ISO UTC. */
  startAt: string;
  startMs: number;
  durationMinutes: number;
  kind: 'video' | 'audio';
  status: ScheduledCallMessageStatus;
  joinUrl: string;
  icsUrl: string;
  googleUrl: string;
  outlookUrl: string;
  /** Creator's user id (`scheduledCallCreatedBy`); '' on an invite that predates it. */
  createdBy: string;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const isScheduledCallMessage = (message: unknown): boolean =>
  text((message as any)?.type) === SCHEDULED_CALL_MESSAGE_TYPE &&
  !!text((message as any)?.scheduledCallSlug);

/**
 * The card data a message carries, or null when it is not a usable invite
 * (no slug, or a start time that is not a date). Defaults follow the
 * contract: 30 minutes, video, status `scheduled`.
 */
export const parseScheduledCallMessage = (
  message: unknown
): ScheduledCallCardData | null => {
  if (!isScheduledCallMessage(message)) {return null;}
  const raw = message as Record<string, any>;
  const startAt = text(raw.scheduledCallStartAt);
  const startMs = Date.parse(startAt);
  if (!Number.isFinite(startMs)) {return null;}

  const duration = Math.round(Number(raw.scheduledCallDurationMinutes));
  const status = text(raw.scheduledCallStatus).toLowerCase();
  return {
    slug: text(raw.scheduledCallSlug),
    title: text(raw.scheduledCallTitle),
    startAt,
    startMs,
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 30,
    kind: text(raw.scheduledCallKind).toLowerCase() === 'audio' ? 'audio' : 'video',
    status:
      status === 'cancelled' || status === 'canceled'
        ? 'cancelled'
        : status === 'updated'
          ? 'updated'
          : 'scheduled',
    joinUrl: text(raw.scheduledCallJoinUrl),
    icsUrl: text(raw.scheduledCallIcsUrl),
    googleUrl: text(raw.scheduledCallGoogleUrl),
    outlookUrl: text(raw.scheduledCallOutlookUrl),
    createdBy: text(raw.scheduledCallCreatedBy),
  };
};

/**
 * One card per slug, latest message wins. "Latest" is the server order
 * (message id, then date); on a tie the one further down the list.
 * Returns slug -> the winning message.
 */
const latestCache = new WeakMap<object, Map<string, IMessage>>();

export const latestScheduledCallMessages = (
  messages: ReadonlyArray<IMessage> | undefined | null
): Map<string, IMessage> => {
  const source = messages || [];
  const cached = latestCache.get(source);
  if (cached) {return cached;}
  const winners = new Map<string, { message: IMessage; at: number }>();
  source.forEach((message) => {
    if (!isScheduledCallMessage(message)) {return;}
    const slug = text((message as any).scheduledCallSlug);
    const at = msgSortableMs(message);
    const current = winners.get(slug);
    if (!current || at >= current.at) {
      winners.set(slug, { message, at });
    }
  });
  const out = new Map<string, IMessage>();
  winners.forEach((value, slug) => out.set(slug, value.message));
  // The store hands out a new array whenever messages change, so the array
  // itself is the cache key (every card in a room shares one pass).
  if (messages) {latestCache.set(messages, out);}
  return out;
};

/** The message that owns this slug's card, or undefined for no invite at all. */
export const latestScheduledCallMessage = (
  messages: ReadonlyArray<IMessage> | undefined | null,
  slug: string
): IMessage | undefined => latestScheduledCallMessages(messages).get(slug);

export const scheduledCallEndMs = (
  card: Pick<ScheduledCallCardData, 'startMs' | 'durationMinutes'>
): number => card.startMs + card.durationMinutes * 60 * 1000;

/** Where a card stands at `now` (epoch ms). */
export const getScheduledCallCardState = (
  card: Pick<
    ScheduledCallCardData,
    'startMs' | 'durationMinutes' | 'status'
  >,
  now: number
): ScheduledCallCardState => {
  if (card.status === 'cancelled') {return 'cancelled';}
  if (now >= scheduledCallEndMs(card)) {return 'ended';}
  if (now >= card.startMs - JOIN_WINDOW_BEFORE_MS) {return 'joinable';}
  return 'upcoming';
};

/**
 * The next instant the card's state changes (join window opens, call ends),
 * or null when it will not change on its own (cancelled / ended). Lets the
 * card sleep until then instead of polling.
 */
export const nextScheduledCallTransition = (
  card: Pick<
    ScheduledCallCardData,
    'startMs' | 'durationMinutes' | 'status'
  >,
  now: number
): number | null => {
  const state = getScheduledCallCardState(card, now);
  if (state === 'upcoming') {return card.startMs - JOIN_WINDOW_BEFORE_MS;}
  if (state === 'joinable') {return scheduledCallEndMs(card);}
  return null;
};

/** Longest a single setTimeout may sleep (the platform clamps at 2^31-1 ms). */
export const MAX_TIMER_MS = 2_000_000_000;

/** The room's bare name, as the call and booking endpoints take it. */
export const chatNameOfRoom = (roomJidOrName: string): string =>
  String(roomJidOrName || '').split('@')[0];
