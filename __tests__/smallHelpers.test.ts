/**
 * Second pure-helper bundle. Tiny utilities; one file keeps the
 * suite count manageable.
 *
 *   - debounce
 *   - getBooleanFromString
 *   - getNumberFromString
 *   - formatNumberWithCommas
 *   - isChatIdPresentInArray
 *   - getTintedColor
 *   - createUserNameFromSetUser
 *   - transformArrayToObject (transformTranslatations)
 *   - extractUniqueMembersFromRooms
 *   - getDataFromXml
 *   - decodeHTMLEntities
 */

import { debounce } from '../src/helpers/debounce';
import { getBooleanFromString } from '../src/helpers/getBooleanFromString';
import { getNumberFromString } from '../src/helpers/getNumberFromString';
import { formatNumberWithCommas } from '../src/helpers/formatNumberWithCommas';
import { isChatIdPresentInArray } from '../src/helpers/isChatIdPresentInArray';
import { getTintedColor } from '../src/helpers/getTintedColor';
import { createUserNameFromSetUser } from '../src/helpers/createUserNameFromSetUser';
import { transformArrayToObject } from '../src/helpers/transformTranslatations';
import { extractUniqueMembersFromRooms } from '../src/helpers/extractUniqueMembersFromRooms';
import { getDataFromXml } from '../src/helpers/getDataFromXml';
import { decodeHTMLEntities } from '../src/helpers/parseMessageBody';

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('collapses multiple rapid calls into a single fire after the delay', () => {
    const fn = jest.fn();
    const d = debounce(fn, 50);
    d('a');
    d('b');
    d('c');
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('a single call after the delay still fires once', () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);
    d('once');
    jest.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith('once');
  });
});

describe('getBooleanFromString', () => {
  it('parses "true" / "false" case-insensitively', () => {
    expect(getBooleanFromString('true')).toBe(true);
    expect(getBooleanFromString('TRUE')).toBe(true);
    expect(getBooleanFromString(' False ')).toBe(false);
  });
  it('returns null for everything else', () => {
    expect(getBooleanFromString('')).toBeNull();
    expect(getBooleanFromString('yes')).toBeNull();
    expect(getBooleanFromString('1')).toBeNull();
  });
});

describe('getNumberFromString', () => {
  it('parses numeric strings', () => {
    expect(getNumberFromString('42')).toBe(42);
    expect(getNumberFromString(' -3.14 ')).toBe(-3.14);
  });
  it('returns null for empty / non-numeric input', () => {
    expect(getNumberFromString('')).toBeNull();
    expect(getNumberFromString('abc')).toBeNull();
  });
});

describe('formatNumberWithCommas', () => {
  it('inserts thousands separators per en-US locale', () => {
    expect(formatNumberWithCommas(1234)).toBe('1,234');
    expect(formatNumberWithCommas(1234567)).toBe('1,234,567');
    // String inputs use String.prototype.toLocaleString which does not
    // re-format — only numeric inputs trigger the comma separator. Pin
    // this so a callsite that relies on the no-op string passthrough
    // isn't broken by a "always parse" refactor.
    expect(formatNumberWithCommas('9876')).toBe('9876');
  });
  it('leaves small numbers alone', () => {
    expect(formatNumberWithCommas(0)).toBe('0');
    expect(formatNumberWithCommas(42)).toBe('42');
  });
});

describe('isChatIdPresentInArray', () => {
  const room = { name: 'r1' };
  it('returns false for an empty list', () => {
    expect(isChatIdPresentInArray('r1@h', [] as any)).toBe(false);
    expect(isChatIdPresentInArray('r1@h', {} as any)).toBe(false);
  });
  it('finds a match against the bare-local part of the JID (array form)', () => {
    expect(isChatIdPresentInArray('r1@host', [room] as any)).toBe(true);
  });
  it('finds a match against the bare-local part of the JID (object form)', () => {
    expect(
      isChatIdPresentInArray('r1@host', { 'r1@host': room as any })
    ).toBe(true);
  });
  it('returns false when no entry matches', () => {
    expect(isChatIdPresentInArray('xyz@host', [room] as any)).toBe(false);
  });
  it('returns false on falsy / non-string id', () => {
    expect(isChatIdPresentInArray('', [room] as any)).toBe(false);
    expect(isChatIdPresentInArray(undefined, [room] as any)).toBe(false);
  });
});

describe('getTintedColor', () => {
  it('returns a hex string with the same length', () => {
    expect(getTintedColor('#0052CD')).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('expands 3-digit hex to 6 before tinting', () => {
    // #f00 → ff0000 → tinted by 20% toward white
    const out = getTintedColor('#f00', 0.2);
    expect(out).toMatch(/^#[0-9A-F]{6}$/);
    // amount 0 returns the input itself (rounded), so no NaN
    const noTint = getTintedColor('#000', 0);
    expect(noTint).toBe('#000000');
  });
  it('tints toward white as amount increases', () => {
    const full = getTintedColor('#000000', 1);
    expect(full).toBe('#FFFFFF');
  });
  it('strips a leading # if present and still works without one', () => {
    const withHash = getTintedColor('#888888', 0.5);
    const noHash = getTintedColor('888888', 0.5);
    expect(withHash).toBe(noHash);
  });
});

describe('createUserNameFromSetUser', () => {
  const users: any = {
    u1: { firstName: 'Alice', lastName: 'Anderson' },
    u2: { firstName: '  ', lastName: '  ' },
    u3: { firstName: 'Bob' },
  };
  it('returns "First Last" when both are present', () => {
    expect(createUserNameFromSetUser(users, 'u1')).toBe('Alice Anderson');
  });
  it('falls back to userId when both names are blank/whitespace', () => {
    expect(createUserNameFromSetUser(users, 'u2')).toBe('u2');
  });
  it('returns "Deleted User" when the id is unknown', () => {
    expect(createUserNameFromSetUser(users, 'missing')).toBe('Deleted User');
  });
  it('handles missing lastName', () => {
    expect(createUserNameFromSetUser(users, 'u3')).toBe('Bob');
  });
});

describe('transformArrayToObject (translatations)', () => {
  it('keys each entry by its `language` field', () => {
    const out = transformArrayToObject([
      { translatedText: 'hola', language: 'es', languageName: 'Spanish' },
      { translatedText: 'salut', language: 'fr', languageName: 'French' },
    ]);
    expect(Object.keys(out)).toEqual(['es', 'fr']);
    expect(out.es.translatedText).toBe('hola');
  });
  it('later entries with the same language win', () => {
    const out = transformArrayToObject([
      { translatedText: 'hola', language: 'es', languageName: 'Spanish' },
      { translatedText: 'buenas', language: 'es', languageName: 'Spanish' },
    ]);
    expect(out.es.translatedText).toBe('buenas');
  });
  it('empty input → empty object', () => {
    expect(transformArrayToObject([])).toEqual({});
  });
});

describe('extractUniqueMembersFromRooms', () => {
  it('dedupes members across rooms by xmppUsername', () => {
    const rooms: any = [
      {
        members: [
          { xmppUsername: '0xa', firstName: 'A' },
          { xmppUsername: '0xb', firstName: 'B' },
        ],
      },
      {
        members: [
          { xmppUsername: '0xa', firstName: 'A duplicate' }, // dedup target
          { xmppUsername: '0xc', firstName: 'C' },
        ],
      },
    ];
    const out = extractUniqueMembersFromRooms(rooms);
    expect(out.array).toHaveLength(3);
    expect(out.set).toEqual(new Set(['0xa', '0xb', '0xc']));
    expect(out.object['0xa'].firstName).toBe('A duplicate'); // last write wins
    expect(out.map.size).toBe(3);
  });
  it('skips members without xmppUsername', () => {
    const rooms: any = [
      { members: [{ firstName: 'Noname' }, { xmppUsername: '0xa' }] },
    ];
    const out = extractUniqueMembersFromRooms(rooms);
    expect(out.array).toHaveLength(1);
  });
  it('tolerates rooms with no members field', () => {
    const out = extractUniqueMembersFromRooms([{}] as any);
    expect(out.array).toEqual([]);
  });
});

describe('getDataFromXml', () => {
  // Build a minimal fake `ltx.Element`-like stanza — the helper only
  // calls `getChild()` + reads `.attrs` / `.getText()`.
  const mkStanza = (
    overrides: {
      id?: string;
      from?: string;
      body?: string;
      deleted?: boolean;
      stanzaId?: string;
      photo?: string;
    } = {}
  ): any => {
    const id =
      overrides.id ?? '00000000-AAAA-1234567890ABCDEF';
    const from = overrides.from ?? 'r@host/0xabc';
    const body = overrides.body;
    const deleted = overrides.deleted ?? false;
    const stanzaId = overrides.stanzaId;

    return {
      attrs: { id, from },
      getChild(name: string) {
        if (name === 'body' && body !== undefined) {
          return { getText: () => body };
        }
        if (name === 'deleted' && deleted) {return {};}
        if (name === 'stanza-id' && stanzaId) {
          return { attrs: { id: stanzaId } };
        }
        if (name === 'data' && overrides.photo) {
          return { attrs: { photo: overrides.photo } };
        }
        return undefined;
      },
    };
  };

  it('extracts body, roomJid, user (id, photoURL), xmppId, xmppFrom from a flat stanza', async () => {
    const stanza = mkStanza({
      id: '1700000000000abc',
      from: 'r@host/0xabc',
      body: 'hi',
      photo: 'http://img.test/a.png',
    });
    const out = await getDataFromXml(stanza);
    expect(out?.body).toBe('hi');
    expect(out?.roomJid).toBe('r@host');
    expect(out?.user.id).toBe('0xabc');
    expect((out?.user as any).photoURL).toBe('http://img.test/a.png');
    expect(out?.xmppId).toBe('1700000000000abc');
    expect(out?.xmppFrom).toBe('r@host/0xabc');
  });

  it('derives ISO date from the leading 13-digit run in the id', async () => {
    const stanza = mkStanza({ id: 'pad1700000000000extra' });
    const out = await getDataFromXml(stanza);
    expect(out?.date).toBe('2023-11-14T22:13:20.000Z');
  });

  it('flags deleted when a <deleted/> child is present', async () => {
    const stanza = mkStanza({ deleted: true });
    const out = await getDataFromXml(stanza);
    expect(out?.deleted).toBe(true);
  });
});

describe('decodeHTMLEntities', () => {
  it('decodes each entity in the standard set (per-entity)', () => {
    // Per-entity assertions sidestep ambiguity in the &nbsp; mapping —
    // the source file's literal could be saved as ASCII U+0020 or
    // NBSP U+00A0 depending on the editor, but the contract a caller
    // cares about is "one decoded character per entity".
    expect(decodeHTMLEntities('&amp;')).toBe('&');
    expect(decodeHTMLEntities('&lt;')).toBe('<');
    expect(decodeHTMLEntities('&gt;')).toBe('>');
    expect(decodeHTMLEntities('&quot;')).toBe('"');
    expect(decodeHTMLEntities('&#39;')).toBe("'");
    expect(decodeHTMLEntities('&ndash;')).toBe('–');
    expect(decodeHTMLEntities('&mdash;')).toBe('—');
    expect(decodeHTMLEntities('&hellip;')).toBe('…');
    expect(decodeHTMLEntities('&#8209;')).toBe('-');
    expect(decodeHTMLEntities('&nbsp;')).toHaveLength(1);
  });
  it('leaves unknown entities untouched', () => {
    expect(decodeHTMLEntities('&unknown; thing')).toBe('&unknown; thing');
  });
  it('passes plain text through unchanged', () => {
    expect(decodeHTMLEntities('plain text')).toBe('plain text');
  });
});
