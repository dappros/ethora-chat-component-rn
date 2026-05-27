/**
 * roomsSlice — reducer-level L1 tests.
 *
 * Complements the existing unreadCounter.test.ts (which covers the
 * unread paths) and persistence.test.ts (which covers the middleware
 * write/read). These tests pin the reducer contract for every action
 * exported from `roomsSlice` — the same surface @ethora chat-component
 * exposes on web. Same test style: call the reducer directly with
 * `(previousState, action)`, no store/middleware/thunks.
 *
 * Cluster mapping (see QA_SCENARIOS.md in the ethora monorepo):
 *   A. Multi-room state machine — addRoom, setCurrentRoom, deleteRoom,
 *      updateRoom, applyRoomsPreloadBatch
 *   D. Send + duplication — addRoomMessage, setRoomMessages,
 *      deleteRoomMessage (tombstone), editRoomMessage
 *   I. Per-room state isolation — setComposing, cross-room sends
 *
 * Stays parity-aware with what landed on `ethora-chat-component`
 * (PR #72) so the same Maestro / Playwright test intents resolve the
 * same way across web + RN.
 */

import roomsReducer, {
  addRoom,
  addRoomMessage,
  deleteAllRooms,
  deleteRoom,
  deleteRoomMessage,
  editRoomMessage,
  setComposing,
  setCurrentRoom,
  setRoomMessages,
  setRoomNoMessages,
  setRoomRole,
  updateRoom,
} from '../src/roomStore/roomsSlice';
import type { IMessage, IRoom } from '../src/types/types';

// ---------- helpers --------------------------------------------------

const initial = () => roomsReducer(undefined, { type: '@@INIT' });

function makeRoom(jid: string, overrides: Partial<IRoom> = {}): IRoom {
  return {
    name: jid.split('@')[0] ?? jid,
    jid,
    title: `Room ${jid.split('@')[0] ?? jid}`,
    usersCnt: 0,
    messages: [],
    isLoading: false,
    roomBg: null,
    ...overrides,
  };
}

function makeMessage(
  id: string,
  overrides: Partial<IMessage> = {}
): IMessage {
  return {
    id,
    user: { id: 'other@xmpp.test', name: 'Other' } as IMessage['user'],
    date: new Date(0),
    body: `body-${id}`,
    roomJid: 'a@conference.test',
    timestamp: 1_000,
    ...overrides,
  };
}

// ---------- Cluster A — multi-room state machine ---------------------

describe('roomsSlice — Cluster A (multi-room state machine)', () => {
  it('addRoom inserts a new room keyed by jid', () => {
    const state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    expect(state.rooms['a@conference.test']).toBeDefined();
    expect(state.rooms['a@conference.test'].title).toBe('Room a');
  });

  it('addRoom overwrites an existing room with the new payload (RN contract)', () => {
    // RN's `addRoom` is an authoritative overwrite — different from
    // chat-component's preserve-existing-unread behaviour. Documenting
    // the divergence here so a future "make these consistent" refactor
    // is a deliberate choice, not a silent drift.
    let state = roomsReducer(
      initial(),
      addRoom({
        roomData: makeRoom('a@conference.test', {
          title: 'Original',
          unreadMessages: 5,
        }),
      })
    );
    state = roomsReducer(
      state,
      addRoom({
        roomData: makeRoom('a@conference.test', {
          title: 'Updated',
          unreadMessages: 0,
        }),
      })
    );
    expect(state.rooms['a@conference.test'].title).toBe('Updated');
    expect(state.rooms['a@conference.test'].unreadMessages).toBe(0);
  });

  it('setCurrentRoom transitions A then B then A', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoom({ roomData: makeRoom('b@conference.test') })
    );

    state = roomsReducer(
      state,
      setCurrentRoom({ roomJID: 'a@conference.test' })
    );
    expect(state.activeRoomJID).toBe('a@conference.test');

    state = roomsReducer(
      state,
      setCurrentRoom({ roomJID: 'b@conference.test' })
    );
    expect(state.activeRoomJID).toBe('b@conference.test');

    state = roomsReducer(
      state,
      setCurrentRoom({ roomJID: 'a@conference.test' })
    );
    expect(state.activeRoomJID).toBe('a@conference.test');
  });

  it('setCurrentRoom(null) clears activeRoomJID without dropping rooms', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoom({ roomData: makeRoom('b@conference.test') })
    );
    state = roomsReducer(state, setCurrentRoom({ roomJID: 'a@conference.test' }));

    state = roomsReducer(state, setCurrentRoom({ roomJID: null }));

    // Reducer normalises null → '' so caller sees a stable string type.
    expect(state.activeRoomJID).toBe('');
    expect(Object.keys(state.rooms).length).toBe(2);
  });

  it('deleteRoom drops only the targeted room', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoom({ roomData: makeRoom('b@conference.test') })
    );

    state = roomsReducer(state, deleteRoom({ jid: 'a@conference.test' }));

    expect(state.rooms['a@conference.test']).toBeUndefined();
    expect(state.rooms['b@conference.test']).toBeDefined();
  });

  it('deleteAllRooms clears the whole rooms map', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoom({ roomData: makeRoom('b@conference.test') })
    );
    state = roomsReducer(state, deleteAllRooms());
    expect(Object.keys(state.rooms).length).toBe(0);
  });

  it('updateRoom merges partial updates without dropping fields', () => {
    let state = roomsReducer(
      initial(),
      addRoom({
        roomData: makeRoom('a@conference.test', {
          title: 'Original',
          unreadMessages: 3,
          description: 'first',
        }),
      })
    );
    state = roomsReducer(
      state,
      updateRoom({
        jid: 'a@conference.test',
        updates: { title: 'Updated' },
      })
    );
    expect(state.rooms['a@conference.test'].title).toBe('Updated');
    expect(state.rooms['a@conference.test'].unreadMessages).toBe(3);
    expect(state.rooms['a@conference.test'].description).toBe('first');
  });

  it('updateRoom on a missing room is a no-op', () => {
    const before = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    const after = roomsReducer(
      before,
      updateRoom({
        jid: 'ghost@conference.test',
        updates: { title: 'never' },
      })
    );
    expect(after).toEqual(before);
  });
});

// ---------- Cluster D — message lifecycle ----------------------------

describe('roomsSlice — Cluster D (message lifecycle)', () => {
  it('setRoomMessages replaces the room messages list', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomMessages({
        roomJID: 'a@conference.test',
        messages: [
          makeMessage('m-1', { body: 'one' }),
          makeMessage('m-2', { body: 'two' }),
        ],
      })
    );
    expect(state.rooms['a@conference.test'].messages.map((m) => m.id)).toEqual([
      'm-1',
      'm-2',
    ]);
  });

  it('addRoomMessage prepends into an empty room', () => {
    // Empty-room path goes through `roomMessages.unshift(message)` —
    // no delimiter insertion since there's nothing to compare lastViewed
    // against. The message lands at index 0 of an otherwise-empty list.
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoomMessage({
        roomJID: 'a@conference.test',
        message: makeMessage('m-1', { body: 'hello' }),
      })
    );
    const messages = state.rooms['a@conference.test'].messages;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('m-1');
  });

  it('addRoomMessage cross-room — adding to A leaves B untouched', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoom({ roomData: makeRoom('b@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomMessages({
        roomJID: 'b@conference.test',
        messages: [
          makeMessage('b-1', { roomJid: 'b@conference.test' }),
        ],
      })
    );

    state = roomsReducer(
      state,
      addRoomMessage({
        roomJID: 'a@conference.test',
        message: makeMessage('a-1', { roomJid: 'a@conference.test' }),
      })
    );

    expect(
      state.rooms['a@conference.test'].messages.map((m) => m.id)
    ).toContain('a-1');
    expect(
      state.rooms['b@conference.test'].messages.map((m) => m.id)
    ).toEqual(['b-1']);
  });

  it('deleteRoomMessage tombstones the bubble (isDeleted=true) instead of dropping', () => {
    // RN's contract matches web: tombstone in-place so ordering /
    // replies / quoting stay intact. Catches a regression where a
    // refactor flips this to a `filter(...)` drop.
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomMessages({
        roomJID: 'a@conference.test',
        messages: [
          makeMessage('doomed', { body: 'delete me', timestamp: 1_000 }),
          makeMessage('survivor', { body: 'keep me', timestamp: 2_000 }),
        ],
      })
    );

    state = roomsReducer(
      state,
      deleteRoomMessage({
        roomJID: 'a@conference.test',
        messageId: 'doomed',
      })
    );

    const messages = state.rooms['a@conference.test'].messages;
    expect(messages.length).toBe(2);
    const doomed = messages.find((m) => m.id === 'doomed');
    expect(doomed?.isDeleted).toBe(true);
  });

  it('editRoomMessage updates the body in place', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomMessages({
        roomJID: 'a@conference.test',
        messages: [makeMessage('m-1', { body: 'original' })],
      })
    );
    state = roomsReducer(
      state,
      editRoomMessage({
        roomJID: 'a@conference.test',
        messageId: 'm-1',
        text: 'edited',
      })
    );
    const m1 = state.rooms['a@conference.test'].messages.find(
      (m) => m.id === 'm-1'
    );
    expect(m1?.body).toBe('edited');
  });

  it('editRoomMessage on a missing message id is a no-op', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomMessages({
        roomJID: 'a@conference.test',
        messages: [makeMessage('m-1', { body: 'original' })],
      })
    );
    const before = state.rooms['a@conference.test'].messages.slice();

    state = roomsReducer(
      state,
      editRoomMessage({
        roomJID: 'a@conference.test',
        messageId: 'ghost',
        text: 'should not appear',
      })
    );
    expect(state.rooms['a@conference.test'].messages).toEqual(before);
  });

  it('addRoomMessage caps the in-memory array at 100 (drops oldest)', () => {
    // Seed the room with 100 messages. Each one strictly newer than
    // the last so insertMessageWithDelimiter takes the append path.
    // We pin `lastViewedTimestamp` past the future messages so the
    // delimiter-new sentinel doesn't get inserted (the addRoom default
    // would otherwise anchor to the newest seeded message, which makes
    // the appended m-100..m-104 land as "unread" and insert a divider —
    // a fine UX behaviour, but not what this test is exercising).
    let state = roomsReducer(
      initial(),
      addRoom({
        roomData: {
          ...makeRoom('a@conference.test'),
          lastViewedTimestamp: Number.MAX_SAFE_INTEGER,
          messages: Array.from({ length: 100 }, (_, i) =>
            makeMessage(`m-${i}`, {
              body: `m-${i}`,
              date: new Date(2026, 0, 1, 0, 0, i).toISOString(),
              timestamp: 1000 + i,
              roomJid: 'a@conference.test',
            })
          ),
        },
      })
    );

    // Append 5 more — should evict the 5 oldest to keep total at 100.
    for (let i = 100; i < 105; i++) {
      state = roomsReducer(
        state,
        addRoomMessage({
          roomJID: 'a@conference.test',
          message: makeMessage(`m-${i}`, {
            body: `m-${i}`,
            date: new Date(2026, 0, 1, 0, 0, i).toISOString(),
            timestamp: 1000 + i,
            roomJid: 'a@conference.test',
          }),
        })
      );
    }

    const msgs = state.rooms['a@conference.test'].messages;
    expect(msgs).toHaveLength(100);
    // Oldest five (m-0..m-4) were dropped; newest five (m-100..m-104)
    // are now at the tail.
    expect(msgs[0].body).toBe('m-5');
    expect(msgs[msgs.length - 1].body).toBe('m-104');
  });

  it('setRoomMessages clips an oversized payload to 100', () => {
    const state = roomsReducer(
      roomsReducer(initial(), addRoom({ roomData: makeRoom('a@conference.test') })),
      setRoomMessages({
        roomJID: 'a@conference.test',
        messages: Array.from({ length: 150 }, (_, i) =>
          makeMessage(`m-${i}`, {
            body: `m-${i}`,
            date: new Date(2026, 0, 1, 0, 0, i).toISOString(),
            roomJid: 'a@conference.test',
          })
        ),
      })
    );

    const msgs = state.rooms['a@conference.test'].messages;
    expect(msgs).toHaveLength(100);
    expect(msgs[0].body).toBe('m-50');
    expect(msgs[99].body).toBe('m-149');
  });
});

// ---------- Per-room isolation + ancillary actions -------------------

describe('roomsSlice — per-room state isolation', () => {
  it('setComposing on one room does not bleed into sibling rooms', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      addRoom({ roomData: makeRoom('b@conference.test') })
    );

    state = roomsReducer(
      state,
      setComposing({
        chatJID: 'a@conference.test',
        composing: true,
        composingList: ['alice'],
      })
    );

    expect(state.rooms['a@conference.test'].composing).toBe(true);
    // Room B is untouched — composing stays in its default (undefined).
    expect(state.rooms['b@conference.test'].composing).toBeFalsy();
  });

  it('setComposing transitions cleanly true → false on the same room', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setComposing({
        chatJID: 'a@conference.test',
        composing: true,
        composingList: ['alice'],
      })
    );
    expect(state.rooms['a@conference.test'].composing).toBe(true);
    state = roomsReducer(
      state,
      setComposing({
        chatJID: 'a@conference.test',
        composing: false,
        composingList: [],
      })
    );
    expect(state.rooms['a@conference.test'].composing).toBe(false);
  });

  it('setRoomRole writes the role back onto the room', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomRole({ chatJID: 'a@conference.test', role: 'owner' })
    );
    expect(state.rooms['a@conference.test'].role).toBe('owner');
  });

  it('setRoomNoMessages flips the noMessages flag on the room', () => {
    let state = roomsReducer(
      initial(),
      addRoom({ roomData: makeRoom('a@conference.test') })
    );
    state = roomsReducer(
      state,
      setRoomNoMessages({ chatJID: 'a@conference.test', value: true })
    );
    expect(state.rooms['a@conference.test'].noMessages).toBe(true);
    state = roomsReducer(
      state,
      setRoomNoMessages({ chatJID: 'a@conference.test', value: false })
    );
    expect(state.rooms['a@conference.test'].noMessages).toBe(false);
  });
});
