/**
 * The "New messages" divider has to sort into the transcript where it
 * belongs — immediately before the first unread message.
 *
 * It used to be stamped with `new Date()` (i.e. now). roomsSlice re-sorts
 * every merged history page by timestamp, so that divider sorted past every
 * real message and rendered at the very BOTTOM of the room — below the new
 * messages it is supposed to introduce.
 */

import { configureStore } from '@reduxjs/toolkit';
import { insertMessageWithDelimiter } from '../src/helpers/insertMessageWithDelimiter';
import roomsReducer, {
  addRoom,
  addRoomMessage,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import { unreadMiddleware } from '../src/roomStore/Middleware/unreadMidlleware';
import { IMessage, IRoom } from '../src/types/types';

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

/**
 * End-to-end through the real redux pipeline (bug #42): since #38 made
 * the marker equal to a real message's own server timestamp rather than
 * always strictly after every read message, the divider and the unread
 * count both have to agree on exactly the same cut - one message too
 * high (or too low) on either side is the regression.
 */
describe('unread divider + count agree at an EXACT marker boundary (bug #42)', () => {
  const ROOM = 'divider@conference.xmpp.chat.ethora.com';
  // 13-digit-ms-prefixed ids, exactly what msgSortableMs / the unread
  // middleware / getServerReadTimestamp all read.
  const N_MS = 1_780_000_000_000;
  const serverMsg = (idMs: number): IMessage =>
    ({
      id: String(idMs),
      user: { id: 'other', name: 'Other', token: '', refreshToken: '' } as any,
      date: new Date(idMs).toISOString(),
      body: `m-${idMs}`,
      roomJid: ROOM,
      showInChannel: 'true',
    } as any);

  const makeStore = () =>
    configureStore({
      reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
      middleware: (g) =>
        g({ serializableCheck: false }).concat(unreadMiddleware),
    });

  it('marker == N\'s own timestamp: divider sits between N and N+1, and unread count == messages after N', () => {
    const store = makeStore();
    // Room NOT visible (no setVisibleRoom/setCurrentRoom dispatched), with
    // lastViewedTimestamp stamped to N's own id-ms - exactly what leaving
    // the room while having reached message N (bug #42's scenario) now
    // stamps via getReadMarkerTimestamp.
    store.dispatch(
      addRoom({
        roomData: {
          id: ROOM,
          name: 'Room',
          jid: ROOM,
          title: 'Room',
          usersCnt: 2,
          messages: [
            serverMsg(N_MS - 5000), // read-1
            serverMsg(N_MS), // N - the last message the user reached
          ],
          isLoading: false,
          roomBg: '',
          lastViewedTimestamp: N_MS,
        } as IRoom,
      })
    );
    // N itself must not be counted - only messages strictly after it.
    expect(store.getState().rooms.rooms[ROOM].unreadMessages).toBe(0);

    // A new message arrives (N+1) while the room stays not-visible.
    store.dispatch(
      addRoomMessage({ roomJID: ROOM, message: serverMsg(N_MS + 1000) })
    );

    const room = store.getState().rooms.rooms[ROOM];
    const ids = room.messages.map((m) => m.id);
    expect(ids).toEqual([
      String(N_MS - 5000),
      String(N_MS),
      'delimiter-new',
      String(N_MS + 1000),
    ]);
    // Exactly the one message after N counts as unread - agreeing with
    // where the divider landed.
    expect(room.unreadMessages).toBe(1);

    // A second new message (N+2) keeps both in lockstep.
    store.dispatch(
      addRoomMessage({ roomJID: ROOM, message: serverMsg(N_MS + 2000) })
    );
    const room2 = store.getState().rooms.rooms[ROOM];
    expect(room2.messages.filter((m) => m.id === 'delimiter-new')).toHaveLength(1);
    expect(room2.unreadMessages).toBe(2);
  });
});
