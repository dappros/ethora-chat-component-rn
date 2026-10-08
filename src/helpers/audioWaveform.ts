/**
 * Waveform helpers for voice messages: the bars a bubble draws, the
 * `waveForm` string a sender attaches to the message, and the recorder's
 * metering turned into the same bars.
 */

/** Floor for a bar, as a fraction of the box: silence is still a dot. */
export const MIN_BAR = 0.08;

/** Resolution a waveform is computed and sent at; bubbles resample it. */
export const WAVEFORM_RESOLUTION = 64;

/**
 * Bars for one clip, from its PCM samples — the same curve as the web
 * client's `buildWaveformPeaks`, so a voice note looks the same on both.
 *
 * RMS per bucket (what the ear hears, not the worst sample), scaled against
 * the 95th percentile so a single click cannot set the scale, then a
 * square-root curve because loudness is perceived that way, and a floor so
 * a quiet passage still reads as a bar rather than as nothing.
 *
 * The decoder WebView carries a copy of this in plain JS (it cannot import
 * modules); keep the two in step.
 */
export const buildWaveformPeaks = (
  samples: ArrayLike<number>,
  barCount: number
): number[] => {
  const bars = Math.max(1, Math.floor(barCount));
  const bucket = Math.floor(samples.length / bars);
  if (bucket < 1) {return new Array(bars).fill(MIN_BAR);}

  const rms: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    let sum = 0;
    for (let j = i * bucket; j < (i + 1) * bucket; j += 1) {
      sum += samples[j]! * samples[j]!;
    }
    rms.push(Math.sqrt(sum / bucket));
  }
  return scaleLevels(rms);
};

/**
 * Raw per-bar levels (RMS, or linear amplitude from the recorder) → 0..1
 * bars, against the 95th percentile with the square-root curve and floor.
 */
export const scaleLevels = (levels: number[]): number[] => {
  if (!levels.length) {return [];}
  const sorted = [...levels].sort((a, b) => a - b);
  const reference =
    sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 0;
  if (reference <= 0) {return levels.map(() => MIN_BAR);}
  return levels.map((value) => {
    const scaled = Math.sqrt(Math.min(value / reference, 1));
    return Math.min(1, MIN_BAR + scaled * (1 - MIN_BAR));
  });
};

/**
 * Stretch or squeeze bars to `count`, taking the loudest bar in each slot
 * when squeezing so a short loud word is not averaged away.
 */
export const resamplePeaks = (peaks: number[], count: number): number[] => {
  const target = Math.max(1, Math.floor(count));
  if (!peaks.length) {return new Array(target).fill(MIN_BAR);}
  if (peaks.length === target) {return peaks;}
  const out: number[] = [];
  for (let i = 0; i < target; i += 1) {
    const from = Math.floor((i * peaks.length) / target);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / target));
    let max = 0;
    for (let j = from; j < to && j < peaks.length; j += 1) {
      max = Math.max(max, peaks[j]!);
    }
    out.push(max);
  }
  return out;
};

/**
 * Recorder metering (dBFS, about -160..0) → linear amplitude 0..1, which
 * `scaleLevels` then treats like an RMS. Anything at or below -60 dB is
 * room noise and counts as silence.
 */
export const meteringToLevel = (db: number | undefined): number => {
  if (typeof db !== 'number' || !Number.isFinite(db) || db <= -60) {return 0;}
  return Math.pow(10, Math.min(db, 0) / 20);
};

/**
 * The `waveForm` attribute a voice message carries: comma-separated bar
 * heights, 0..100. Short enough for a stanza attribute, plain enough for
 * any client to read.
 */
export const encodeWaveForm = (peaks: number[]): string =>
  peaks
    .map((p) => Math.round(Math.max(0, Math.min(1, p)) * 100))
    .join(',');

/**
 * Bars from a message's `waveForm`, or null when it has none / nothing
 * usable. Accepts the comma list above and a JSON array, in 0..1 or 0..100.
 */
export const parseWaveForm = (value: unknown): number[] | null => {
  if (typeof value !== 'string' || !value.trim()) {return null;}
  let raw: unknown[];
  const text = value.trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {return null;}
      raw = parsed;
    } catch {
      return null;
    }
  } else {
    raw = text.split(',');
  }
  const numbers = raw.map((n) => Number(n));
  if (numbers.length < 2 || numbers.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  const max = Math.max(...numbers);
  const scale = max > 1 ? 100 : 1;
  return numbers.map((n) => Math.max(MIN_BAR, Math.min(1, n / scale)));
};

/** Seconds from a message's `duration` attribute, or 0 when absent. */
export const parseDurationSeconds = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** `0:07`, `1:23`, `12:05`. */
export const formatClipTime = (millis: number): string => {
  const safe = Number.isFinite(millis) && millis > 0 ? millis : 0;
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};
