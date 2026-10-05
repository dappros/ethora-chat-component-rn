/**
 * roomsSlice: safe dynamic keys, users set merge with cap, jump window state
 * and its sync with the live copy (ported from the web PR #100 tests).
 */
import reducer, {
  JUMP_WINDOW_MAX_MESSAGES,
  addRoom,
  addRoomFromApi,
  addRoomMessage,
  appendJumpWindowMessages,
  applyPrivateStoreMarkers,
  applyRoomsPreloadBatch,
  clearJumpWindow,
  deleteRoomMessage,
  editRoomMessage,
  mergeUsersSet,
  prependJumpWindowMessages,
  removeRoomMessage,
  setActiveMessage,
  setCloseActiveMessage,
  setComposing,
  setCurrentRoom,
  setIsLoading,
  setJumpWindow,
  setLogoutState,
  setMessageTranslation,
  setReactions,
  setRoomNoMessages,
  setRoomRole,
  setVisibleRoom,
  updateRoom,
} from '../src/roomStore/roomsSlice';
import { USERS_SET_CAP } from '../src/roomStore/usersSetCap';

const ROOM = 'room@conference.example.com';
const OTHER = 'other@conference.example.com';
const UNSAFE = ['__proto__', 'constructor', 'prototype'];

const clean = () => {
  expect(({} as any).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
};
const base = () => reducer(undefined, { type: '@@INIT' });
const withRoom = () =>
  reducer(
    base(),
    addRoom({
      roomData: {
        jid: ROOM,
        title: 'r',
        messages: [{ id: '1', body: 'a', date: new Date().toISOString(), user: { id: 'u' } }],
      } as any,
    })
  );

describe('reducers ignore unsafe dynamic keys', () => {
  it.each(UNSAFE)('room-keyed reducers with %s', (bad) => {
    let s = withRoom();
    expect(() => {
      s = reducer(s, setComposing({ chatJID: bad, composing: true } as any));
      s = reducer(s, setRoomRole({ chatJID: bad, role: 'polluted' }));
      s = reducer(s, setRoomNoMessages({ chatJID: bad, value: true }));
      s = reducer(s, setIsLoading({ chatJID: bad, loading: true }));
      s = reducer(s, updateRoom({ jid: bad, updates: { polluted: 1 } as any }));
      s = reducer(s, setCurrentRoom({ roomJID: bad }));
      s = reducer(s, setVisibleRoom({ roomJID: bad }));
      s = reducer(s, applyPrivateStoreMarkers({ [bad]: 5 }));
      s = reducer(s, applyRoomsPreloadBatch({ rooms: [{ jid: bad, historyComplete: true }] }));
      s = reducer(
        s,
        addRoomMessage({
          roomJID: bad,
          message: { id: '2', body: 'x', date: '', user: { id: 'u' } },
        } as any)
      );
      s = reducer(s, addRoom({ roomData: { jid: bad, title: 'x' } as any }));
      s = reducer(s, addRoomFromApi({ room: { jid: bad, title: 'x' } as any }));
    }).not.toThrow();
    expect(Object.keys(s.rooms)).toEqual([ROOM]);
    expect(s.activeRoomJID).toBeNull();
    expect(s.visibleRoomJID).toBeNull();
    expect(s.privateStoreMarkers).toEqual({});
    clean();
  });

  it.each(UNSAFE)('user and message-keyed maps with %s', (bad) => {
    let s = withRoom();
    expect(() => {
      s = reducer(s, mergeUsersSet({ members: JSON.parse(`{"${bad}":{"firstName":"p"}}`) }));
      s = reducer(
        s,
        setReactions({
          roomJID: ROOM,
          messageId: '1',
          reactions: ['x'],
          from: `${bad}@host`,
        } as any)
      );
      s = reducer(
        s,
        setMessageTranslation({
          roomJID: ROOM,
          messageId: '1',
          locale: bad,
          entry: { polluted: 1 } as any,
        })
      );
    }).not.toThrow();
    expect(Object.keys(s.usersSet || {})).toEqual([]);
    expect(s.rooms[ROOM].messages[0].reaction).toBeUndefined();
    expect(s.rooms[ROOM].messages[0].translations).toBeUndefined();
    clean();
  });

  it('the echo merge does not follow a __proto__ key', () => {
    const payload = JSON.parse(
      '{"id":"1","body":"a","date":"","user":{"id":"u"},"__proto__":{"polluted":true},"extra":{"__proto__":{"polluted":true}}}'
    );
    expect(() =>
      reducer(withRoom(), addRoomMessage({ roomJID: ROOM, message: payload } as any))
    ).not.toThrow();
    clean();
  });

  it('safe keys still work', () => {
    let s = withRoom();
    s = reducer(s, setRoomRole({ chatJID: ROOM, role: 'moderator' }));
    s = reducer(s, mergeUsersSet({ members: { alice: { firstName: 'A' } } }));
    s = reducer(s, setCurrentRoom({ roomJID: ROOM }));
    expect(s.rooms[ROOM].role).toBe('moderator');
    expect(s.usersSet?.alice).toBeDefined();
    expect(s.activeRoomJID).toBe(ROOM);
    expect(reducer(s, setCurrentRoom({ roomJID: null })).activeRoomJID).toBe('');
  });
});

describe('mergeUsersSet', () => {
  it('is a merge: fresh wins, lazily fetched entries stay', () => {
    let s = reducer(base(), mergeUsersSet({ members: { a: { firstName: 'old' }, b: { firstName: 'lazy' } } }));
    s = reducer(s, mergeUsersSet({ members: { a: { firstName: 'fresh' } } }));
    expect(s.usersSet?.a.firstName).toBe('fresh');
    expect(s.usersSet?.b.firstName).toBe('lazy');
  });
  it('is capped, evicting the oldest-inserted', () => {
    const members: Record<string, any> = {};
    for (let i = 0; i < USERS_SET_CAP + 10; i++) members[`k${i}`] = { firstName: 'x' };
    const s = reducer(base(), mergeUsersSet({ members }));
    expect(Object.keys(s.usersSet || {})).toHaveLength(USERS_SET_CAP);
    expect(s.usersSet?.k0).toBeUndefined();
  });
  it('logout clears it', () => {
    const s = reducer(reducer(base(), mergeUsersSet({ members: { a: {} } })), setLogoutState());
    expect(s.usersSet).toEqual({});
  });
});

describe('usersCnt', () => {
  const members = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ _id: `m${i}`, xmppUsername: `u${i}` }));
  it('addRoomFromApi never lowers a larger known count', () => {
    let s = reducer(base(), addRoomFromApi({ room: { jid: ROOM, title: 'r', usersCnt: 435, members: members(30) } as any }));
    expect(s.rooms[ROOM].usersCnt).toBe(435);
    s = reducer(s, addRoomFromApi({ room: { jid: ROOM, title: 'r', usersCnt: 30, members: members(30) } as any }));
    expect(s.rooms[ROOM].usersCnt).toBe(435);
  });
  it('addRoom takes the API total over a truncated members page', () => {
    const s = reducer(base(), addRoom({ roomData: { jid: ROOM, title: 'r', usersCnt: 435, members: members(30) } as any }));
    expect(s.rooms[ROOM].usersCnt).toBe(435);
  });
  it('updateRoom: an explicit count (live leave) is taken, members are the floor', () => {
    let s = reducer(base(), addRoom({ roomData: { jid: ROOM, title: 'r', usersCnt: 5 } as any }));
    s = reducer(s, updateRoom({ jid: ROOM, updates: { usersCnt: 4 } }));
    expect(s.rooms[ROOM].usersCnt).toBe(4);
    s = reducer(s, updateRoom({ jid: ROOM, updates: { usersCnt: 1, members: members(3) as any } }));
    expect(s.rooms[ROOM].usersCnt).toBe(3);
  });
  it('updateRoom: a members-only refresh of a truncated room keeps the true total', () => {
    let s = reducer(base(), addRoom({ roomData: { jid: ROOM, title: 'r', usersCnt: 435, members: members(30) } as any }));
    s = reducer(s, updateRoom({ jid: ROOM, updates: { members: members(30) as any } }));
    expect(s.rooms[ROOM].usersCnt).toBe(435);
  });
});

describe('history cursors are writable', () => {
  it('updateRoom and applyRoomsPreloadBatch set messageStats and historyComplete', () => {
    let s = withRoom();
    s = reducer(
      s,
      updateRoom({
        jid: ROOM,
        updates: { historyComplete: true, messageStats: { firstMessageTimestamp: 5, lastMessageTimestamp: 6 } },
      })
    );
    expect(s.rooms[ROOM].historyComplete).toBe(true);
    expect(s.rooms[ROOM].messageStats).toEqual({ firstMessageTimestamp: 5, lastMessageTimestamp: 6 });
    s = reducer(
      s,
      applyRoomsPreloadBatch({
        rooms: [{ jid: ROOM, historyComplete: false, messageStats: { firstMessageTimestamp: 1 } }],
      })
    );
    expect(s.rooms[ROOM].historyComplete).toBe(false);
    expect(s.rooms[ROOM].messageStats).toEqual({ firstMessageTimestamp: 1, lastMessageTimestamp: 6 });
  });
});

// ---------------------------------------------------------------- jump window

const msg = (n: number, extra: Record<string, unknown> = {}) =>
  ({
    id: String(1_000_000_000_000_000 + n * 1000),
    body: `m${n}`,
    date: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    roomJid: ROOM,
    user: { id: 'u', name: 'U' },
    ...extra,
  }) as any;
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
const open = (from = 100, to = 120) =>
  reducer(
    base(),
    setJumpWindow({
      roomJID: ROOM,
      messages: range(from, to),
      targetId: msg(110).id,
      olderCursor: Number(msg(from).id),
      hasOlder: true,
      newerCursor: Number(msg(to).id),
      hasNewer: true,
    })
  );

describe('jumpWindow reducer', () => {
  it('starts empty', () => {
    expect(base().jumpWindow).toBeNull();
  });

  it('sets a window without touching the live history', () => {
    const start = reducer(
      withRoom(),
      updateRoom({
        jid: ROOM,
        updates: { historyComplete: false, messageStats: { firstMessageTimestamp: 5, lastMessageTimestamp: 6 } },
      })
    );
    const state = reducer(
      start,
      setJumpWindow({
        roomJID: ROOM,
        messages: range(100, 110),
        targetId: msg(105).id,
        olderCursor: 1,
        hasOlder: true,
        newerCursor: 2,
        hasNewer: true,
      })
    );
    expect(state.jumpWindow?.messages).toHaveLength(11);
    expect(state.rooms).toBe(start.rooms);
  });

  it('prepends older messages in order, without duplicates', () => {
    const state = reducer(
      open(),
      prependJumpWindowMessages({
        roomJID: ROOM,
        messages: range(95, 101),
        olderCursor: Number(msg(95).id),
        hasOlder: false,
      })
    );
    expect(state.jumpWindow!.messages.map((m) => m.id)).toEqual(range(95, 120).map((m) => m.id));
    expect(state.jumpWindow!.hasOlder).toBe(false);
    expect(state.jumpWindow!.olderCursor).toBe(Number(msg(95).id));
    expect(state.jumpWindow!.hasNewer).toBe(true);
  });

  it('appends newer messages and updates the newer cursor', () => {
    const state = reducer(
      open(),
      appendJumpWindowMessages({
        roomJID: ROOM,
        messages: range(121, 140),
        newerCursor: Number(msg(140).id),
        hasNewer: false,
      })
    );
    expect(state.jumpWindow!.messages).toHaveLength(41);
    expect(state.jumpWindow!.hasNewer).toBe(false);
    expect(state.jumpWindow!.newerCursor).toBe(Number(msg(140).id));
  });

  it('ignores pages for another room', () => {
    const start = open();
    const state = reducer(
      start,
      appendJumpWindowMessages({
        roomJID: OTHER,
        messages: range(121, 130),
        newerCursor: 1,
        hasNewer: false,
      })
    );
    expect(state.jumpWindow).toBe(start.jumpWindow);
  });

  it('trims the newest side when growing upward past the bound', () => {
    const state = reducer(
      open(1000, 1250),
      prependJumpWindowMessages({
        roomJID: ROOM,
        messages: range(950, 999),
        olderCursor: Number(msg(950).id),
        hasOlder: true,
      })
    );
    const win = state.jumpWindow!;
    expect(win.messages).toHaveLength(JUMP_WINDOW_MAX_MESSAGES);
    expect(win.messages[0].id).toBe(msg(950).id);
    expect(win.hasNewer).toBe(true);
    expect(win.newerCursor).toBe(Number(win.messages[win.messages.length - 1].id));
  });

  it('trims the oldest side when growing downward past the bound', () => {
    const state = reducer(
      open(1000, 1250),
      appendJumpWindowMessages({
        roomJID: ROOM,
        messages: range(1251, 1300),
        newerCursor: Number(msg(1300).id),
        hasNewer: false,
      })
    );
    const win = state.jumpWindow!;
    expect(win.messages).toHaveLength(JUMP_WINDOW_MAX_MESSAGES);
    expect(win.messages[win.messages.length - 1].id).toBe(msg(1300).id);
    expect(win.hasOlder).toBe(true);
    expect(win.olderCursor).toBe(Number(win.messages[0].id));
  });

  it('clears, and logout clears it too', () => {
    expect(reducer(open(), clearJumpWindow()).jumpWindow).toBeNull();
    expect(reducer(open(), setLogoutState()).jumpWindow).toBeNull();
  });
});

describe('jump window copy stays in sync with the live copy', () => {
  const setup = (opts: { hasNewer?: boolean; live?: any[]; win?: any[] } = {}) => {
    const live = opts.live ?? [msg(1), msg(2), msg(3)];
    const win = opts.win ?? [msg(1), msg(2), msg(3)];
    let state = reducer(base(), addRoom({ roomData: { jid: ROOM, title: 'r', messages: live } as any }));
    state = reducer(
      state,
      setJumpWindow({
        roomJID: ROOM,
        messages: win,
        targetId: win[0].id,
        olderCursor: null,
        hasOlder: false,
        newerCursor: null,
        hasNewer: opts.hasNewer ?? true,
      })
    );
    return state;
  };
  const live = (s: any, id: string) => s.rooms[ROOM].messages.find((m: any) => m.id === id);
  const win = (s: any, id: string) => s.jumpWindow.messages.find((m: any) => m.id === id);

  it('reactions: add and remove', () => {
    const id = msg(2).id;
    let s = reducer(
      setup(),
      setReactions({ roomJID: ROOM, messageId: id, reactions: ['x'], from: 'alice@host', data: {} } as any)
    );
    expect(win(s, id).reaction.alice.emoji).toEqual(['x']);
    expect(live(s, id).reaction.alice.emoji).toEqual(['x']);
    s = reducer(s, setReactions({ roomJID: ROOM, messageId: id, reactions: [], from: 'alice@host' } as any));
    expect(win(s, id).reaction.alice).toBeUndefined();
  });

  it('edit', () => {
    const id = msg(2).id;
    const s = reducer(setup(), editRoomMessage({ roomJID: ROOM, messageId: id, text: 'edited' }));
    expect(win(s, id).body).toBe('edited');
    expect(win(s, id).isEdited).toBe(true);
    expect(live(s, id).body).toBe('edited');
  });

  it('delete marks both copies', () => {
    const id = msg(2).id;
    const s = reducer(setup(), deleteRoomMessage({ roomJID: ROOM, messageId: id }));
    expect(win(s, id).isDeleted).toBe(true);
    expect(live(s, id).isDeleted).toBe(true);
  });

  it('removeRoomMessage drops it from the window too', () => {
    const id = msg(2).id;
    const s = reducer(setup(), removeRoomMessage({ roomJID: ROOM, messageId: id }));
    expect(win(s, id)).toBeUndefined();
    expect(live(s, id)).toBeUndefined();
  });

  it('translation', () => {
    const id = msg(2).id;
    const s = reducer(
      setup(),
      setMessageTranslation({
        roomJID: ROOM,
        messageId: id,
        locale: 'fr',
        entry: { translatedText: 'bonjour', language: 'fr', languageName: 'French' },
      })
    );
    expect(win(s, id).translations.fr).toBeDefined();
    expect(live(s, id).translations.fr).toBeDefined();
  });

  it('delivery echo reconciles the window copy (pending -> sent)', () => {
    const m = msg(2, { pending: true });
    const base0 = setup({ live: [msg(1), m], win: [msg(1), m] });
    const s = reducer(
      base0,
      addRoomMessage({ roomJID: ROOM, message: { ...m, pending: false, body: 'm2' } } as any)
    );
    expect(win(s, m.id).pending).toBe(false);
    expect(live(s, m.id).pending).toBe(false);
  });

  it('active message flag', () => {
    const id = msg(2).id;
    let s = reducer(setup(), setActiveMessage({ id, chatJID: ROOM }));
    expect(win(s, id).activeMessage).toBe(true);
    expect(win(s, msg(1).id).activeMessage).toBe(false);
    s = reducer(s, setCloseActiveMessage({ chatJID: ROOM }));
    expect(win(s, id).activeMessage).toBe(false);
  });

  it('a window on another room is left alone', () => {
    const id = msg(2).id;
    let s = setup();
    s = reducer(s, addRoom({ roomData: { jid: OTHER, title: 'o', messages: [msg(2)] } as any }));
    s = reducer(s, editRoomMessage({ roomJID: OTHER, messageId: id, text: 'other' }));
    expect(win(s, id).body).toBe('m2');
  });

  describe('new live messages while a window is open', () => {
    const fresh = msg(9);
    it('stay out of the window while it is away from the tail (hasNewer)', () => {
      const s = reducer(setup({ hasNewer: true }), addRoomMessage({ roomJID: ROOM, message: fresh } as any));
      expect(live(s, fresh.id)).toBeDefined();
      expect(win(s, fresh.id)).toBeUndefined();
    });
    it('are appended when the window already reaches the live end', () => {
      const s = reducer(setup({ hasNewer: false }), addRoomMessage({ roomJID: ROOM, message: fresh } as any));
      expect(live(s, fresh.id)).toBeDefined();
      expect(s.jumpWindow!.messages.map((m) => m.id).pop()).toBe(fresh.id);
    });
    it('are not duplicated when the id is already in the window', () => {
      const s = reducer(
        setup({ hasNewer: false, win: [msg(1), msg(2), msg(3), fresh] }),
        addRoomMessage({ roomJID: ROOM, message: fresh } as any)
      );
      expect(s.jumpWindow!.messages.filter((m) => m.id === fresh.id)).toHaveLength(1);
    });
    it('history prepends (start) never touch the window', () => {
      const s = reducer(
        setup({ hasNewer: false }),
        addRoomMessage({ roomJID: ROOM, message: msg(0), start: true } as any)
      );
      expect(win(s, msg(0).id)).toBeUndefined();
    });
  });
});
