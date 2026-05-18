/**
 * Pure-helper bundle — small leaf utilities that don't need a
 * dedicated file each.
 *
 *   - nanoToMs               — XMPP microsecond id → ms timestamp
 *   - dateComparison         — isDateBefore / isDateAfter
 *   - walletToUsername /     — wallet ↔ underscore-snake username
 *     usernameToWallet
 *   - nameToColor (hashcolor) — deterministic avatar background
 *   - validateMessages        — message-shape sanity check
 *   - getHighResolutionTimestamp — monotonic id source for sends
 *
 * No mocks needed; everything in this file is synchronous + pure.
 */

import { nanoToMs } from '../src/helpers/nanoToMs';
import {
  isDateAfter,
  isDateBefore,
  getHighResolutionTimestamp,
} from '../src/helpers/dateComparison';
import {
  walletToUsername,
  usernameToWallet,
} from '../src/helpers/walletUsername';
import { nameToColor } from '../src/helpers/hashcolor';
import { validateMessages } from '../src/helpers/validator';

describe('nanoToMs', () => {
  it('truncates a 16-char microsecond id to the leading 13-char ms timestamp', () => {
    // 1700000000000 = 2023-11-14T22:13:20Z
    expect(nanoToMs('1700000000000123')).toBe(1700000000000);
  });

  it('returns the number itself when the input is shorter than 13 chars', () => {
    // slice(0, 13) of '100' is '100' → +'100' → 100
    expect(nanoToMs('100')).toBe(100);
  });

  it('returns null when slice resolves to 0 (falsy guard)', () => {
    // slice(0, 13) of '0000000000000' → +'0000000000000' = 0 → || null
    expect(nanoToMs('0000000000000')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(nanoToMs('')).toBeNull();
  });
});

describe('dateComparison', () => {
  it('isDateBefore: returns true when the first date is strictly earlier', () => {
    expect(
      isDateBefore('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')
    ).toBe(true);
  });

  it('isDateBefore: returns false for equal dates (strict <)', () => {
    expect(
      isDateBefore('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    ).toBe(false);
  });

  it('isDateAfter: returns true when the first date is strictly later', () => {
    expect(
      isDateAfter('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')
    ).toBe(true);
  });

  it('isDateAfter: returns false for equal dates (strict >)', () => {
    expect(
      isDateAfter('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    ).toBe(false);
  });

  it('returns false on either side when an input is NaN-Date', () => {
    // `new Date("garbage")` is NaN; comparisons against NaN are false.
    expect(isDateBefore('garbage', '2026-01-01T00:00:00Z')).toBe(false);
    expect(isDateAfter('garbage', '2026-01-01T00:00:00Z')).toBe(false);
  });

  it('getHighResolutionTimestamp returns a numeric string of at least 19 chars', () => {
    const a = getHighResolutionTimestamp();
    expect(/^\d+$/.test(a)).toBe(true);
    // ms part (13) + microsecond pad (6) = 19 chars
    expect(a.length).toBeGreaterThanOrEqual(19);
  });

  it('getHighResolutionTimestamp produces a non-decreasing sequence', () => {
    const a = getHighResolutionTimestamp();
    const b = getHighResolutionTimestamp();
    // The ms+microsecond timestamp is monotonic non-decreasing during
    // the same ms tick; assert lexicographic ≤ on equal-length strings.
    expect(BigInt(b) >= BigInt(a)).toBe(true);
  });
});

describe('walletUsername', () => {
  it('walletToUsername inserts an underscore before every capital and lowercases', () => {
    expect(walletToUsername('Foo')).toBe('_foo');
    expect(walletToUsername('FooBar')).toBe('_foo_bar');
    expect(walletToUsername('0xAbCdEf')).toBe('0x_ab_cd_ef');
  });

  it('walletToUsername returns "" for falsy input', () => {
    expect(walletToUsername('')).toBe('');
    expect(walletToUsername(null as any)).toBe('');
  });

  it('usernameToWallet uppercases each char preceded by an underscore', () => {
    expect(usernameToWallet('_foo')).toBe('Foo');
    expect(usernameToWallet('_foo_bar')).toBe('FooBar');
    expect(usernameToWallet('0x_ab_cd_ef')).toBe('0xAbCdEf');
  });

  it('walletToUsername ↔ usernameToWallet round-trips a typical wallet local', () => {
    const local = '0xAbCdEf123';
    expect(usernameToWallet(walletToUsername(local))).toBe(local);
  });
});

describe('nameToColor (hashcolor)', () => {
  it('returns transparent for falsy input', () => {
    expect(nameToColor('')).toEqual({ backgroundColor: 'transparent' });
  });

  it('returns a deterministic color for the same name across calls', () => {
    const a = nameToColor('Alice Anderson');
    const b = nameToColor('Alice Anderson');
    expect(a).toEqual(b);
  });

  it('returns a color from the fixed 15-entry palette', () => {
    const palette = new Set([
      '#86d1ee', '#badfff', '#E2F4FB', '#B1E1D9', '#B8F1C4',
      '#E0FFBE', '#D3C2F1', '#EEE6F9', '#E7BDE6', '#FEBDD1',
      '#FFEBEE', '#F1DCB6', '#FFE0B6', '#E8E4C9', '#F5F2BC',
    ]);
    const out = nameToColor('Bob');
    expect(palette.has(out!.backgroundColor)).toBe(true);
  });

  it('different names usually map to different colors (spot check)', () => {
    // Not a probabilistic guarantee — we know these two hashes land on
    // distinct palette indices in the current implementation, so pin
    // it as a regression guard.
    const a = nameToColor('Alice');
    const b = nameToColor('Engineering');
    expect(a?.backgroundColor).not.toBe(b?.backgroundColor);
  });
});

describe('validateMessages', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  const baseMsg = {
    id: '1',
    user: { id: 'u', name: 'u' },
    date: '2026-05-15T00:00:00Z',
    body: 'hi',
  };

  it('returns true when every required attribute is present', () => {
    expect(validateMessages([baseMsg as any, baseMsg as any])).toBe(true);
  });

  it('returns false when a required attribute is missing', () => {
    const { id, ...rest } = baseMsg;
    expect(validateMessages([rest as any])).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('missing attributes: id')
    );
  });

  it('reports each invalid row independently', () => {
    const { body, ...noBody } = baseMsg;
    const { user, ...noUser } = baseMsg;
    expect(
      validateMessages([noBody as any, baseMsg as any, noUser as any])
    ).toBe(false);
    // Two errors reported (one per bad row), good row didn't log.
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('returns true for an empty input', () => {
    expect(validateMessages([])).toBe(true);
  });
});
