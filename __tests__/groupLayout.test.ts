import {
  MAX_VIDEO_TILES,
  gridColumns,
  pickVideoTiles,
  speakingNames,
} from '../src/components/VideoCalls/groupLayout';
import type { CallParticipantView } from '../src/components/VideoCalls/callSessionTypes';

const person = (
  identity: string,
  over: Partial<CallParticipantView> = {}
): CallParticipantView => ({
  identity,
  name: identity.toUpperCase(),
  isLocal: false,
  video: null,
  micMuted: false,
  speaking: false,
  ...over,
});

describe('gridColumns', () => {
  it('uses one column for one person, two up to four, three beyond (portrait)', () => {
    expect([1, 2, 3, 4, 5, 9, 50].map((n) => gridColumns(n, false))).toEqual([
      1, 2, 2, 2, 3, 3, 3,
    ]);
  });

  it('widens in landscape, never beyond the number of people', () => {
    expect([1, 2, 3, 4, 5, 20].map((n) => gridColumns(n, true))).toEqual([
      1, 2, 3, 4, 4, 4,
    ]);
  });

  it('copes with an empty room', () => {
    expect(gridColumns(0, false)).toBe(1);
  });
});

describe('pickVideoTiles', () => {
  const live = { video: { live: true } };

  it('only people with a live camera take a video slot', () => {
    const picked = pickVideoTiles([
      person('a', live),
      person('b'),
      person('c', live),
    ]);
    expect([...picked].sort()).toEqual(['a', 'c']);
  });

  it('spends the budget on speakers first, then us, then the rest in order', () => {
    const people = [
      person('a', live),
      person('me', { ...live, isLocal: true }),
      person('b', live),
      person('c', { ...live, speaking: true }),
      person('d', live),
    ];
    expect([...pickVideoTiles(people, 2)]).toEqual(['c', 'me']);
    expect([...pickVideoTiles(people, 3)]).toEqual(['c', 'me', 'a']);
  });

  it('never exceeds the default budget in a big room', () => {
    const people = Array.from({ length: 50 }, (_, i) => person(`p${i}`, live));
    expect(pickVideoTiles(people).size).toBe(MAX_VIDEO_TILES);
  });

  it('a zero or negative budget shows no video', () => {
    expect(pickVideoTiles([person('a', live)], 0).size).toBe(0);
    expect(pickVideoTiles([person('a', live)], -3).size).toBe(0);
  });
});

describe('speakingNames', () => {
  it('names the speakers, calling us by the given label', () => {
    expect(
      speakingNames(
        [
          person('a', { speaking: true }),
          person('me', { speaking: true, isLocal: true }),
          person('b'),
        ],
        'You'
      )
    ).toEqual(['A', 'You']);
  });

  it('is empty when nobody speaks', () => {
    expect(speakingNames([person('a')], 'You')).toEqual([]);
  });
});
