import {
  dayEndISO,
  dayStartISO,
  isBackwardsRange,
  matchPeople,
} from '../src/components/Modals/MessageSearchModal/searchFilters';

describe('day boundaries', () => {
  it("spans the whole chosen day in the reader's time zone", () => {
    const start = new Date(dayStartISO('2026-07-14') as string);
    const end = new Date(dayEndISO('2026-07-14') as string);
    expect([
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      start.getHours(),
    ]).toEqual([2026, 6, 14, 0]);
    expect([
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
      end.getSeconds(),
    ]).toEqual([14, 23, 59, 59]);
    // and the end is strictly after the start, i.e. the day is not empty
    expect(end.getTime() - start.getTime()).toBeGreaterThan(23 * 3600 * 1000);
  });

  it('rejects anything that is not a yyyy-mm-dd day', () => {
    for (const bad of ['', 'notadate', '2026-7-4', '14/07/2026']) {
      expect(dayStartISO(bad)).toBeUndefined();
      expect(dayEndISO(bad)).toBeUndefined();
    }
  });

  it('detects a backwards range only when both ends are set', () => {
    expect(isBackwardsRange('2026-07-20', '2026-07-10')).toBe(true);
    expect(isBackwardsRange('2026-07-10', '2026-07-10')).toBe(false);
    expect(isBackwardsRange('', '2026-07-10')).toBe(false);
  });
});

describe('matchPeople', () => {
  const people = [
    { _id: '1', firstName: 'Anna', lastName: 'Smith' },
    { _id: '2', firstName: 'Joanna', lastName: 'Lee' },
    { _id: '3', firstName: 'Bob', lastName: 'Annan' },
    { _id: '4', name: 'Anna Smith' },
    { _id: '1', firstName: 'Anna', lastName: 'Smith' }, // duplicate id
    { firstName: 'No', lastName: 'Id' },
  ];

  it('ranks names that start with the text above names that contain it', () => {
    expect(matchPeople(people, 'ann').map((p) => p.id)).toEqual([
      '1',
      '4',
      '2',
      '3',
    ]);
  });

  it('is case-insensitive, skips duplicates and people without an id, and never returns more than the limit', () => {
    expect(matchPeople(people, 'ANNA', 2)).toHaveLength(2);
    expect(matchPeople(people, 'no')).toEqual([]);
    expect(matchPeople(people, '   ')).toEqual([]);
  });
});

describe('free-text day entry (no native date input in RN)', () => {
  const { isValidDay } =
    require('../src/components/Modals/MessageSearchModal/searchFilters');

  it('rejects half-typed and impossible days', () => {
    expect(isValidDay('2026-07-14')).toBe(true);
    expect(isValidDay('2026-07-1')).toBe(false);
    expect(isValidDay('2026-02-31')).toBe(false);
    expect(dayStartISO('2026-02-31')).toBeUndefined();
    expect(dayEndISO('abc')).toBeUndefined();
  });

  it('does not call a range backwards while one end is not a real day yet', () => {
    expect(isBackwardsRange('2026-07-14', '2026-07-1')).toBe(false);
    expect(isBackwardsRange('2026-07-14', '2026-07-13')).toBe(true);
  });
});
