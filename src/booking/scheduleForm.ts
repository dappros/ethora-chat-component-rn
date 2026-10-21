/**
 * Pure helpers behind the schedule / edit sheet: the default start, the
 * stepper arithmetic and the validation the server repeats.
 */

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;
export const DEFAULT_DURATION_MINUTES = 30;
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];
export const TIME_STEP_MINUTES = 15;
export const TITLE_MAX = 200;
export const NOTES_MAX = 2000;
/** The server accepts a start this far in the past (clock skew). */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

const MINUTE = 60 * 1000;

/** The next quarter hour that is at least 15 minutes away. */
export const defaultStartMs = (now: number): number => {
  const step = TIME_STEP_MINUTES * MINUTE;
  const earliest = now + 15 * MINUTE;
  return Math.ceil(earliest / step) * step;
};

/** Move by whole local days (DST safe: done on the calendar, not by 24 h). */
export const shiftDays = (ms: number, days: number): number => {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

export const shiftMinutes = (ms: number, minutes: number): number =>
  ms + minutes * MINUTE;

export const clampDuration = (minutes: number): number => {
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n)) {return DEFAULT_DURATION_MINUTES;}
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, n));
};

export type ScheduleFormError = 'pastTime' | null;

/** Only the rules the client can check; the server stays the authority. */
export const validateStart = (
  startMs: number,
  now: number,
  options?: { allowPast?: boolean }
): ScheduleFormError => {
  if (!Number.isFinite(startMs)) {return 'pastTime';}
  if (options?.allowPast) {return null;}
  return startMs < now - CLOCK_SKEW_MS ? 'pastTime' : null;
};

export const deviceTimezone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

export const formatDay = (ms: number, locale?: string): string => {
  try {
    return new Date(ms).toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return new Date(ms).toDateString();
  }
};

export const formatClock = (ms: number, locale?: string): string => {
  try {
    return new Date(ms).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ms).toTimeString().slice(0, 5);
  }
};
