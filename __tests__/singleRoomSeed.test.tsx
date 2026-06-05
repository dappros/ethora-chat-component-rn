/**
 * Regression: single-room mode must SEED the configured room into the
 * store so ChatRoom can render it.
 *
 * The bug (recurring — the original fix was lost in a refactor): in
 * single-room mode (`<Chat roomJID=... config={{disableRooms:true}}>`)
 * `activeRoomJID` is set synchronously, but the room OBJECT only arrives
 * via getRoomsStanza (which can return type=error) or REST /chats/my
 * (which may omit it / be slow). ChatRoom renders the "Start a
 * Conversation" placeholder whenever `roomsList[activeRoomJID]` is
 * absent, and getHistoryStanza can't rescue it (addRoomMessage drops
 * messages for rooms not yet in the store). On slower/flaky devices the
 * chat stuck on the placeholder forever — works on most iOS & some
 * Android, fails on the rest.
 *
 * ChatWrapper fixes this by seeding `buildSeedRoom(normalizeRoomJid(...))`
 * via `addRoom` when the room is absent. Mounting the full ChatWrapper in
 * Jest drags in the entire modal/media native-ESM graph (expo-video etc.),
 * so we instead lock the runtime pieces the effect actually composes:
 * normalizeRoomJid → buildSeedRoom → addRoom reducer.
 */

import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import { buildSeedRoom } from '../src/helpers/buildSeedRoom';
import { normalizeRoomJid } from '../src/helpers/normalizeRoomJid';

describe('buildSeedRoom', () => {
  test('produces a minimal, store-valid room (no title/messages)', () => {
    const room = buildSeedRoom('abc123@conference.host');
    expect(room).toMatchObject({
      id: 'abc123',
      jid: 'abc123@conference.host',
      name: '',
      title: '',
      usersCnt: 0,
      messages: [],
      isLoading: false,
      roomBg: null,
    });
  });
});

describe('single-room seed pipeline (normalize → build → addRoom)', () => {
  const initialState = () => roomsReducer(undefined, { type: '@@INIT' });

  const seed = (state: any, rawJID: string, conference?: string) => {
    const jid = normalizeRoomJid(rawJID, conference);
    return roomsReducer(state, addRoom({ roomData: buildSeedRoom(jid) }));
  };

  test('seeds a bare JID normalized with the conference suffix', () => {
    const state = seed(initialState(), 'abc123', 'conference.host');
    expect(state.rooms['abc123@conference.host']).toBeDefined();
    expect(state.rooms['abc123@conference.host']).toMatchObject({
      jid: 'abc123@conference.host',
      messages: [],
    });
  });

  test('uses an already-qualified JID as-is', () => {
    const state = seed(initialState(), 'room@conference.host');
    expect(state.rooms['room@conference.host']).toBeDefined();
  });

  test('seed is gated on absence — an existing real room is left intact', () => {
    // A real room as getRoomsStanza / /chats/my would deliver it.
    let state = roomsReducer(
      initialState(),
      addRoom({
        roomData: {
          id: 'room',
          jid: 'room@conference.host',
          name: 'Real Room',
          title: 'Real Room',
          usersCnt: 3,
          messages: [
            { id: '1', body: 'hello', date: '2024-01-01T00:00:00Z' } as any,
          ],
          isLoading: false,
          roomBg: null,
        },
      })
    );

    // ChatWrapper only dispatches the seed when the room is ABSENT
    // (`seededRoomMissing = !!jid && !rooms[jid]`). addRoom itself spreads
    // the blank seed over `title`/`name`, so re-seeding a present room
    // WOULD blank it — the component's absence guard is what prevents
    // that. Replicate the guard here.
    const jid = normalizeRoomJid('room@conference.host');
    if (!state.rooms[jid]) {
      state = roomsReducer(state, addRoom({ roomData: buildSeedRoom(jid) }));
    }

    const room = state.rooms['room@conference.host'];
    expect(room.title).toBe('Real Room');
    expect(room.messages).toHaveLength(1);
  });
});
