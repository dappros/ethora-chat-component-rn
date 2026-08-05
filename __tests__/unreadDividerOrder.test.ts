/**
 * The "New messages" divider has to sort into the transcript where it
 * belongs — immediately before the first unread message.
 *
 * It used to be stamped with `new Date()` (i.e. now). roomsSlice re-sorts
 * every merged history page by timestamp, so that divider sorted past every
 * real message and rendered at the very BOTTOM of the room — below the new
 * messages it is supposed to introduce.
 */

import { insertMessageWithDelimiter } from '../src/helpers/insertMessageWithDelimiter';
import { IMessage } from '../src/types/types';

const at = (iso: string, id: string): any => ({
  id,
  body: id,
  date: iso,
  roomJid: 'r@h',
  user: { id: 'someone', name: 'John' },
});

const msSort = (a: any, b: any) => Date.parse(a.date) - Date.parse(b.date);

describe('unread divider ordering', () => {
  it('anchors the divider just before the first unread message', () => {
    const lastViewed = Date.parse('2026-08-05T08:30:00.000Z');
    const messages: Partial<IMessage>[] = [
      at('2026-08-05T08:00:00.000Z', 'read-1'),
      at('2026-08-05T08:15:00.000Z', 'read-2'),
      at('2026-08-05T08:35:00.000Z', 'unread-1'),
    ];

    insertMessageWithDelimiter(
      messages,
      at('2026-08-05T08:36:00.000Z', 'unread-2'),
      new Date(lastViewed)
    );

    const divider = messages.find((m) => m.id === 'delimiter-new')!;
    expect(divider).toBeDefined();

    const dividerMs = Date.parse(String(divider.date));
    const firstUnreadMs = Date.parse('2026-08-05T08:35:00.000Z');
    const lastReadMs = Date.parse('2026-08-05T08:15:00.000Z');

    // Strictly between the last read and the first unread, so no sort can
    // move it out of place.
    expect(dividerMs).toBeLessThan(firstUnreadMs);
    expect(dividerMs).toBeGreaterThan(lastReadMs);
  });

  it('survives a re-sort in the position it was placed', () => {
    const lastViewed = Date.parse('2026-08-05T08:30:00.000Z');
    const messages: Partial<IMessage>[] = [
      at('2026-08-05T08:00:00.000Z', 'read-1'),
      at('2026-08-05T08:35:00.000Z', 'unread-1'),
    ];

    insertMessageWithDelimiter(
      messages,
      at('2026-08-05T08:36:00.000Z', 'unread-2'),
      new Date(lastViewed)
    );

    // Exactly what roomsSlice does to a merged page.
    const sorted = messages.slice().sort(msSort);
    const ids = sorted.map((m) => m.id);

    // The regression: with `date: new Date()` the divider sorted last, so
    // ids ended `[..., 'unread-2', 'delimiter-new']`.
    expect(ids).toEqual(['read-1', 'delimiter-new', 'unread-1', 'unread-2']);
    expect(ids[ids.length - 1]).not.toBe('delimiter-new');
  });
});
