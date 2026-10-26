/**
 * The invite card's rules: what a scheduledCall message says, which message
 * owns the card of a slug, and the state machine
 * upcoming -> joinable -> ended, or cancelled.
 */

import {
  JOIN_WINDOW_BEFORE_MS,
  getScheduledCallCardState,
  isScheduledCallMessage,
  latestScheduledCallMessage,
  latestScheduledCallMessages,
  nextScheduledCallTransition,
  parseScheduledCallMessage,
  scheduledCallEndMs,
} from '../src/booking/scheduledCall';

const MIN = 60_000;
const START = Date.parse('2026-11-03T14:30:00.000Z');
const SLUG = 'Zq8x_LmN3pRtV-w2YkA9bc';

const msg = (over: Record<string, unknown> = {}, id = '1760000000000000') => ({
  id,
  date: new Date(Number(id.slice(0, 13))).toISOString(),
  roomJid: 'room@conference.x',
  body: 'Scheduled call: Sync',
  user: { id: 'system' },
  type: 'scheduledCall',
  scheduledCallSlug: SLUG,
  scheduledCallTitle: 'Sync',
  scheduledCallStartAt: new Date(START).toISOString(),
  scheduledCallDurationMinutes: '45',
  scheduledCallKind: 'video',
  scheduledCallStatus: 'scheduled',
  scheduledCallJoinUrl: `https://app.chat.ethora.com/call/${SLUG}`,
  scheduledCallIcsUrl: 'https://api.chat.ethora.com/v1/calls/scheduled/x.ics',
  scheduledCallCreatedBy: 'u-123',
  scheduledCallGoogleUrl: 'https://calendar.google.com/calendar/render?x=1',
  scheduledCallOutlookUrl: 'https://outlook.live.com/calendar/0/deeplink/compose?x=1',
  ...over,
}) as any;

describe('parseScheduledCallMessage', () => {
  it('reads the contract attributes', () => {
    expect(parseScheduledCallMessage(msg())).toEqual({
      slug: SLUG,
      title: 'Sync',
      startAt: new Date(START).toISOString(),
      startMs: START,
      durationMinutes: 45,
      kind: 'video',
      status: 'scheduled',
      joinUrl: `https://app.chat.ethora.com/call/${SLUG}`,
      icsUrl: 'https://api.chat.ethora.com/v1/calls/scheduled/x.ics',
      googleUrl: 'https://calendar.google.com/calendar/render?x=1',
      outlookUrl: 'https://outlook.live.com/calendar/0/deeplink/compose?x=1',
      createdBy: 'u-123',
    });
  });

  it('applies the defaults: 30 minutes, video, scheduled', () => {
    const card = parseScheduledCallMessage(
      msg({
        scheduledCallDurationMinutes: undefined,
        scheduledCallKind: undefined,
        scheduledCallStatus: undefined,
      })
    );
    expect(card).toMatchObject({ durationMinutes: 30, kind: 'video', status: 'scheduled' });
  });

  it('knows audio, updated and cancelled', () => {
    expect(parseScheduledCallMessage(msg({ scheduledCallKind: 'audio' }))?.kind).toBe('audio');
    expect(parseScheduledCallMessage(msg({ scheduledCallStatus: 'updated' }))?.status).toBe('updated');
    expect(parseScheduledCallMessage(msg({ scheduledCallStatus: 'cancelled' }))?.status).toBe('cancelled');
  });

  it('is null without a slug, another type, or an unreadable start', () => {
    expect(parseScheduledCallMessage(msg({ scheduledCallSlug: '' }))).toBeNull();
    expect(parseScheduledCallMessage(msg({ type: 'call-state' }))).toBeNull();
    expect(parseScheduledCallMessage(msg({ scheduledCallStartAt: 'soon' }))).toBeNull();
    expect(isScheduledCallMessage({ body: 'hi' })).toBe(false);
  });
});

describe('one card per slug, latest status wins', () => {
  it('picks the newest message for each slug', () => {
    const first = msg({}, '1760000000000001');
    const updated = msg(
      { scheduledCallStatus: 'updated', scheduledCallTitle: 'Sync v2' },
      '1760000100000002'
    );
    const other = msg({ scheduledCallSlug: 'other-slug-0123456789abc' }, '1760000050000003');
    const winners = latestScheduledCallMessages([first, other, updated]);
    expect(winners.size).toBe(2);
    expect(winners.get(SLUG)).toBe(updated);
    expect(winners.get('other-slug-0123456789abc')).toBe(other);
  });

  it('a cancel after an update wins; an old duplicate does not', () => {
    const created = msg({}, '1760000000000001');
    const updated = msg({ scheduledCallStatus: 'updated' }, '1760000100000001');
    const cancelled = msg({ scheduledCallStatus: 'cancelled' }, '1760000200000001');
    // Out of order, as history pages arrive.
    const winner = latestScheduledCallMessage([cancelled, created, updated], SLUG);
    expect(winner).toBe(cancelled);
    expect(parseScheduledCallMessage(winner)?.status).toBe('cancelled');
  });

  it('ignores ordinary messages and finds nothing for an unknown slug', () => {
    expect(latestScheduledCallMessage([{ id: '1', body: 'hi' } as any], SLUG)).toBeUndefined();
    expect(latestScheduledCallMessage(undefined, SLUG)).toBeUndefined();
  });

  it('reuses one pass for the same message array', () => {
    const list = [msg()];
    expect(latestScheduledCallMessages(list)).toBe(latestScheduledCallMessages(list));
  });
});

describe('card state machine', () => {
  const card = { startMs: START, durationMinutes: 45, status: 'scheduled' as const };

  it('is upcoming until 15 minutes before the start', () => {
    expect(getScheduledCallCardState(card, START - 3 * 60 * MIN)).toBe('upcoming');
    expect(getScheduledCallCardState(card, START - JOIN_WINDOW_BEFORE_MS - 1)).toBe('upcoming');
  });

  it('is joinable from 15 minutes before the start until the end', () => {
    expect(getScheduledCallCardState(card, START - JOIN_WINDOW_BEFORE_MS)).toBe('joinable');
    expect(getScheduledCallCardState(card, START)).toBe('joinable');
    expect(getScheduledCallCardState(card, scheduledCallEndMs(card) - 1)).toBe('joinable');
  });

  it('is ended from start + duration on', () => {
    expect(scheduledCallEndMs(card)).toBe(START + 45 * MIN);
    expect(getScheduledCallCardState(card, START + 45 * MIN)).toBe('ended');
    expect(getScheduledCallCardState(card, START + 10 * 60 * MIN)).toBe('ended');
  });

  it('cancelled beats every time-based state', () => {
    const cancelled = { ...card, status: 'cancelled' as const };
    [START - 99 * MIN, START, START + 999 * MIN].forEach((now) =>
      expect(getScheduledCallCardState(cancelled, now)).toBe('cancelled')
    );
  });

  it('an updated invite is live like a scheduled one', () => {
    expect(
      getScheduledCallCardState({ ...card, status: 'updated' }, START)
    ).toBe('joinable');
  });

  it('knows when the state changes next', () => {
    expect(nextScheduledCallTransition(card, START - 60 * MIN)).toBe(
      START - JOIN_WINDOW_BEFORE_MS
    );
    expect(nextScheduledCallTransition(card, START)).toBe(START + 45 * MIN);
    expect(nextScheduledCallTransition(card, START + 99 * MIN)).toBeNull();
    expect(
      nextScheduledCallTransition({ ...card, status: 'cancelled' }, START - 60 * MIN)
    ).toBeNull();
  });
});
