import {
  MIN_BAR,
  buildWaveformPeaks,
  encodeWaveForm,
  formatClipTime,
  meteringToLevel,
  parseWaveForm,
  resamplePeaks,
  scaleLevels,
} from '../src/helpers/audioWaveform';

describe('voice message waveform', () => {
  it('does not let one click flatten the rest of the clip', () => {
    // Quiet speech with a single full-scale transient in the middle.
    const samples = new Float32Array(1000).map((_, i) =>
      i === 500 ? 1 : Math.sin(i) * 0.05
    );
    const peaks = buildWaveformPeaks(samples, 10);
    expect(peaks).toHaveLength(10);
    // Every speech bar stays well above the floor.
    peaks.forEach((p) => expect(p).toBeGreaterThan(0.5));
  });

  it('draws silence as the floor, not as nothing', () => {
    expect(buildWaveformPeaks(new Float32Array(100), 4)).toEqual(
      new Array(4).fill(MIN_BAR)
    );
    expect(scaleLevels([0, 0, 0])).toEqual([MIN_BAR, MIN_BAR, MIN_BAR]);
  });

  it('keeps the loudest bar when squeezing', () => {
    expect(resamplePeaks([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
    expect(resamplePeaks([0.5], 3)).toEqual([0.5, 0.5, 0.5]);
  });

  it('round-trips through the waveForm attribute', () => {
    const encoded = encodeWaveForm([0, 0.5, 1]);
    expect(encoded).toBe('0,50,100');
    expect(parseWaveForm(encoded)).toEqual([MIN_BAR, 0.5, 1]);
    expect(parseWaveForm('[0.2, 0.4]')).toEqual([0.2, 0.4]);
  });

  it('ignores a waveForm it cannot use', () => {
    expect(parseWaveForm(undefined)).toBeNull();
    expect(parseWaveForm('')).toBeNull();
    expect(parseWaveForm('abc,def')).toBeNull();
    expect(parseWaveForm('42')).toBeNull();
  });

  it('turns recorder metering into a level', () => {
    expect(meteringToLevel(undefined)).toBe(0);
    expect(meteringToLevel(-160)).toBe(0);
    expect(meteringToLevel(0)).toBe(1);
    expect(meteringToLevel(-20)).toBeCloseTo(0.1);
  });

  it('formats clip times', () => {
    expect(formatClipTime(0)).toBe('0:00');
    expect(formatClipTime(17_400)).toBe('0:17');
    expect(formatClipTime(83_000)).toBe('1:23');
  });
});
