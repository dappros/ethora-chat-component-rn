/**
 * insertMessageWithDelimiter — pure-helper L1 tests.
 *
 * Drives the "New Messages" divider that splits a room's message list
 * at the user's `lastViewedTimestamp`. Behavioural contract:
 *   - Dedup by `id`, with `xmppId` ←→ `id` fallback used to flip the
 *     optimistic pending bubble to delivered in place.
 *   - Newer messages append; the divider is injected at the boundary
 *     between read and unread on the first newer message.
 *   - Older messages prepend; in-range messages insert at correct
 *     date order.
 *   - The helper only receives a real last-viewed timestamp for rooms
 *     that are not currently visible. Visible rooms pass `null`, so no
 *     divider is injected while the user is actively looking at them.
 *
 * The helper mutates the array in place — that's part of the contract
 * (the slice reducer relies on immer to wrap the mutation).
 */

import { insertMessageWithDelimiter } from '../src/helpers/insertMessageWithDelimiter';
import type { IMessage } from '../src/types/types';

const DAY = (iso: string) => new Date(iso).toISOString();

const makeMsg = (
  id: string,
  date: string,
  overrides: Partial<IMessage> = {}
): IMessage =>
  ({
    id,
    user: { id: 'u', name: 'u', token: '', refreshToken: '' } as any,
    date: DAY(date),
    body: `body-${id}`,
    roomJid: 'r@h',
    ...overrides,
  } as IMessage);

// Wrap a numeric millisecond timestamp in the loose
// `{ toString(): string }` shape the helper expects (matches how the
// reducer passes `Date | null`).
const ts = (iso: string) => new Date(iso);

describe('insertMessageWithDelimiter — append path', () => {
  it('appends a strictly-newer message at the end', () => {
    const list: IMessage[] = [makeMsg('a', '2026-05-01T10:00:00Z')];
    insertMessageWithDelimiter(list, makeMsg('b', '2026-05-01T11:00:00Z'), null);
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('prepends a strictly-older message at the front', () => {
    const list: IMessage[] = [makeMsg('a', '2026-05-01T10:00:00Z')];
    insertMessageWithDelimiter(list, makeMsg('z', '2026-04-30T10:00:00Z'), null);
    expect(list.map((m) => m.id)).toEqual(['z', 'a']);
  });

  it('inserts an in-range message at correct chronological position', () => {
    const list: IMessage[] = [
      makeMsg('a', '2026-05-01T10:00:00Z'),
      makeMsg('c', '2026-05-01T12:00:00Z'),
    ];
    insertMessageWithDelimiter(list, makeMsg('b', '2026-05-01T11:00:00Z'), null);
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('insertMessageWithDelimiter — dedup', () => {
  it('replaces an existing message with same id and clears `pending`', () => {
    const list: IMessage[] = [
      makeMsg('a', '2026-05-01T10:00:00Z', { pending: true, body: 'old' }),
    ];
    insertMessageWithDelimiter(
      list,
      makeMsg('a', '2026-05-01T10:00:00Z', { body: 'delivered' }),
      null
    );
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('delivered');
    expect(list[0].pending).toBe(false);
  });

  it('flips optimistic pending bubble in place when the server echo xmppId matches the local id', () => {
    const list: IMessage[] = [
      makeMsg('local-send-id', '2026-05-01T10:00:00Z', {
        pending: true,
      }),
    ];
    insertMessageWithDelimiter(
      list,
      makeMsg('server-stanza-id', '2026-05-01T10:00:00Z', {
        xmppId: 'local-send-id',
      } as any),
      null
    );
    expect(list).toHaveLength(1);
    // deepMerge keeps the new id (server id) overlaid on the old row
    expect(list[0].id).toBe('server-stanza-id');
    expect(list[0].pending).toBe(false);
  });

  it('matches when the existing row carries xmppId and the incoming id equals it', () => {
    const list: IMessage[] = [
      makeMsg('row-id', '2026-05-01T10:00:00Z', {
        xmppId: 'shared',
      } as any),
    ];
    insertMessageWithDelimiter(
      list,
      makeMsg('shared', '2026-05-01T10:00:00Z', { body: 'updated' }),
      null
    );
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('updated');
  });
});

describe('insertMessageWithDelimiter — merge does not drop translations', () => {
  it('keeps an existing translation when the incoming update has no <translations> element', () => {
    // Mirrors exactly what getDataFromXml/createMessageFromXml hand back
    // for a stanza that didn't carry a <translations> element: the field
    // is present on the object, explicitly `undefined` (see
    // src/helpers/getDataFromXml.ts) — not simply absent. `for...in`
    // still visits an explicit-`undefined` key, so a naive merge would
    // read `source.translations === undefined` and overwrite the
    // existing value with it, silently erasing a translation the row
    // already had (e.g. a MAM catch-up echo, or a live update that only
    // carries a reaction/edit) — a message flipping from translated back
    // to the original for no reason.
    const list: IMessage[] = [
      makeMsg('a', '2026-05-01T10:00:00Z', {
        langSource: 'en',
        translations: {
          es: {
            translatedText: 'hola',
            language: 'es',
            languageName: 'Spanish',
          },
        },
      } as any),
    ];

    const incoming = makeMsg('a', '2026-05-01T10:00:00Z', {
      body: 'hi (edited)',
    }) as any;
    incoming.translations = undefined; // explicit key, not simply omitted

    insertMessageWithDelimiter(list, incoming, null);

    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('hi (edited)');
    expect((list[0] as any).translations?.es?.translatedText).toBe('hola');
  });

  it('still lets a real translations payload overwrite the old one', () => {
    const list: IMessage[] = [
      makeMsg('a', '2026-05-01T10:00:00Z', {
        translations: {
          es: { translatedText: 'stale', language: 'es', languageName: 'Spanish' },
        },
      } as any),
    ];

    insertMessageWithDelimiter(
      list,
      makeMsg('a', '2026-05-01T10:00:00Z', {
        translations: {
          es: { translatedText: 'fresh', language: 'es', languageName: 'Spanish' },
        },
      } as any),
      null
    );

    expect((list[0] as any).translations?.es?.translatedText).toBe('fresh');
  });
});

describe('insertMessageWithDelimiter — "New Messages" divider', () => {
  it('injects the divider when the newer message crosses lastViewedTimestamp', () => {
    const list: IMessage[] = [makeMsg('old', '2026-05-01T10:00:00Z')];
    insertMessageWithDelimiter(
      list,
      makeMsg('new', '2026-05-01T12:00:00Z'),
      ts('2026-05-01T11:00:00Z')
    );
    // Order: old, delimiter (at index of first newer), new
    expect(list.map((m) => m.id)).toEqual(['old', 'delimiter-new', 'new']);
    // Divider carries the system marker for downstream renderers.
    const divider = list.find((m) => m.id === 'delimiter-new');
    expect(divider?.body).toBe('New Messages');
    expect((divider?.user as any)?.id).toBe('system');
  });

  it('does not duplicate the divider on subsequent newer messages', () => {
    const list: IMessage[] = [makeMsg('old', '2026-05-01T10:00:00Z')];
    const cutoff = ts('2026-05-01T11:00:00Z');
    insertMessageWithDelimiter(
      list,
      makeMsg('n1', '2026-05-01T12:00:00Z'),
      cutoff
    );
    insertMessageWithDelimiter(
      list,
      makeMsg('n2', '2026-05-01T12:30:00Z'),
      cutoff
    );
    const dividerCount = list.filter((m) => m.id === 'delimiter-new').length;
    expect(dividerCount).toBe(1);
    expect(list.map((m) => m.id)).toEqual([
      'old',
      'delimiter-new',
      'n1',
      'n2',
    ]);
  });

  it('does not inject the divider when the new message is also pre-cutoff', () => {
    const list: IMessage[] = [makeMsg('old', '2026-05-01T10:00:00Z')];
    insertMessageWithDelimiter(
      list,
      makeMsg('also-old', '2026-05-01T10:30:00Z'),
      ts('2026-05-01T11:00:00Z')
    );
    expect(list.some((m) => m.id === 'delimiter-new')).toBe(false);
  });

  it('does not inject the divider when callers pass null for the visible room', () => {
    const list: IMessage[] = [makeMsg('old', '2026-05-01T10:00:00Z')];
    insertMessageWithDelimiter(
      list,
      makeMsg('new', '2026-05-01T12:00:00Z'),
      null
    );
    expect(list.some((m) => m.id === 'delimiter-new')).toBe(false);
    expect(list.map((m) => m.id)).toEqual(['old', 'new']);
  });

  it('no divider when lastViewedTimestamp is null (no read marker)', () => {
    const list: IMessage[] = [makeMsg('old', '2026-05-01T10:00:00Z')];
    insertMessageWithDelimiter(
      list,
      makeMsg('new', '2026-05-01T12:00:00Z'),
      null
    );
    expect(list.some((m) => m.id === 'delimiter-new')).toBe(false);
  });
});
