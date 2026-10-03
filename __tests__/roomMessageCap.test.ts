/**
 * The in-memory cap trims only growth at the NEW end: pages of older
 * history (scrolling back) are kept, so a long transcript can actually be
 * read, and a live message never trims below what is already loaded.
 */
import roomsReducer, {
  addRoom,
  addRoomMessage,
  addRoomMessages,
  RUNTIME_MESSAGE_LIMIT,
} from '../src/roomStore/roomsSlice';
import type { IMessage } from '../src/types/types';

const JID = 'r@h';
const msg = (n: number): IMessage =>
  ({
    id: String(1_700_000_000_000_000 + n * 1000),
    body: `m${n}`,
    date: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    roomJid: JID,
    user: { id: 'u', name: 'u' } as any,
  } as IMessage);

const seed = () => {
  let state = roomsReducer(undefined, { type: '@@init' });
  state = roomsReducer(
    state,
    addRoom({
      roomData: { jid: JID, name: 'r', title: 'r', messages: [], usersCnt: 1 } as any,
    })
  );
  // Exactly the resting limit of newest messages, n = 1000..1099.
  const page = Array.from({ length: RUNTIME_MESSAGE_LIMIT }, (_, i) => msg(1000 + i));
  return roomsReducer(state, addRoomMessages({ roomJID: JID, messages: page }));
};

describe('room message cap', () => {
  it('keeps an older page scrolled in instead of dropping it', () => {
    let state = seed();
    expect(state.rooms[JID].messages).toHaveLength(RUNTIME_MESSAGE_LIMIT);
    const older = Array.from({ length: 15 }, (_, i) => msg(985 + i));
    state = roomsReducer(state, addRoomMessages({ roomJID: JID, messages: older }));
    expect(state.rooms[JID].messages).toHaveLength(RUNTIME_MESSAGE_LIMIT + 15);
    expect(state.rooms[JID].messages[0].body).toBe('m985');
  });

  it('a live message after scrolling back trims one oldest, not back to the resting limit', () => {
    let state = seed();
    const older = Array.from({ length: 15 }, (_, i) => msg(985 + i));
    state = roomsReducer(state, addRoomMessages({ roomJID: JID, messages: older }));
    state = roomsReducer(state, addRoomMessage({ roomJID: JID, message: msg(1100) }));
    const messages = state.rooms[JID].messages;
    expect(messages).toHaveLength(RUNTIME_MESSAGE_LIMIT + 15);
    expect(messages[0].body).toBe('m986');
    expect(messages[messages.length - 1].body).toBe('m1100');
  });

  it('still trims a room that only receives new messages to the resting limit', () => {
    let state = seed();
    state = roomsReducer(state, addRoomMessage({ roomJID: JID, message: msg(1100) }));
    expect(state.rooms[JID].messages).toHaveLength(RUNTIME_MESSAGE_LIMIT);
    expect(state.rooms[JID].messages[0].body).toBe('m1001');
  });
});
