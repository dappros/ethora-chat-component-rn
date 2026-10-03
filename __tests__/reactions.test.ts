/**
 * Message reactions: store semantics (web-compatible shape), archived
 * reactions folded onto their page, deferred ones dispatched, and a
 * reaction stanza never turning into a message.
 */
import roomsReducer, {
  addRoom,
  addRoomMessages,
  deleteRoomMessage,
  setReactions,
  applyReactionToMessage,
} from '../src/roomStore/roomsSlice';
import { applyMamReactions, extractReaction } from '../src/helpers/mamReactions';
import type { IMessage } from '../src/types/types';

const JID = 'r@conference.h';
const msg = (id: string): IMessage =>
  ({
    id,
    body: id,
    date: '2026-05-15T10:00:00Z',
    roomJid: JID,
    user: { id: 'u', name: 'u' } as any,
  } as IMessage);

const seeded = () => {
  let state = roomsReducer(undefined, { type: '@@init' });
  state = roomsReducer(
    state,
    addRoom({ roomData: { jid: JID, name: 'r', title: 'r', messages: [], usersCnt: 1 } as any })
  );
  return roomsReducer(state, addRoomMessages({ roomJID: JID, messages: [msg('1'), msg('2')] }));
};

describe('setReactions', () => {
  it('stores one entry per reactor keyed by the local part, with the sender name', () => {
    let state = seeded();
    state = roomsReducer(
      state,
      setReactions({
        roomJID: JID,
        messageId: '1',
        from: 'alice@h/phone',
        reactions: ['joy', '+1'],
        data: { senderFirstName: 'Alice', senderLastName: 'A' },
      })
    );
    const m = state.rooms[JID].messages.find((x) => x.id === '1')!;
    expect(m.reaction).toEqual({
      alice: { emoji: ['joy', '+1'], data: { senderFirstName: 'Alice', senderLastName: 'A' } },
    });
  });

  it('an empty list removes that reactor; the last removal clears the field', () => {
    let state = seeded();
    const react = (from: string, reactions: string[]) =>
      (state = roomsReducer(state, setReactions({ roomJID: JID, messageId: '1', from, reactions })));
    react('alice@h', ['joy']);
    react('bob@h', ['heart']);
    react('alice@h', []);
    expect(Object.keys(state.rooms[JID].messages[0].reaction!)).toEqual(['bob']);
    react('bob@h', []);
    expect(state.rooms[JID].messages[0].reaction).toBeUndefined();
  });

  it('ignores a reaction without a reactor', () => {
    const m = msg('x');
    applyReactionToMessage(m, undefined, ['joy']);
    expect(m.reaction).toBeUndefined();
  });

  it('deleting a message drops its reactions', () => {
    let state = seeded();
    state = roomsReducer(state, setReactions({ roomJID: JID, messageId: '1', from: 'a@h', reactions: ['joy'] }));
    state = roomsReducer(state, deleteRoomMessage({ roomJID: JID, messageId: '1' }));
    expect(state.rooms[JID].messages[0].reaction).toBeUndefined();
  });
});

const el = (name: string, attrs: Record<string, string>, children: any[] = [], text = '') => ({
  name,
  attrs,
  children,
  is: (n: string) => n === name,
  getChild: (n: string) => children.find((c) => c.name === n),
  getChildren: (n: string) => children.filter((c) => c.name === n),
  text: () => text,
});

describe('archived reactions', () => {
  const reactionStanza = (targetId: string, from: string, ids: string[]) =>
    el('message', { from: `${JID}/alice` }, [
      el('reactions', { id: targetId, from, xmlns: 'urn:xmpp:reactions:0' },
        ids.map((id) => el('reaction', {}, [], id))),
      el('data', { senderFirstName: 'Alice', senderLastName: 'A' }),
      el('stanza-id', { by: JID, id: '999' }),
    ]);

  it('extracts target, reactor, ids and room', () => {
    const r = extractReaction(reactionStanza('1', 'alice@h/phone', ['joy', '']));
    expect(r).toEqual({
      messageId: '1',
      from: 'alice@h/phone',
      emoji: ['joy'],
      data: { senderFirstName: 'Alice', senderLastName: 'A' },
      roomJID: JID,
      ts: '999',
    });
  });

  it('folds reactions onto the page and defers the rest', () => {
    const page = [msg('1'), msg('2')];
    const deferred = applyMamReactions(page, [
      extractReaction(reactionStanza('2', 'bob@h', ['heart']))!,
      extractReaction(reactionStanza('404', 'bob@h', ['fire']))!,
    ]);
    expect(page[1].reaction).toEqual({
      bob: { emoji: ['heart'], data: { senderFirstName: 'Alice', senderLastName: 'A' }, ts: '999' },
    });
    expect(page[0].reaction).toBeUndefined();
    expect(deferred.map((d) => d.messageId)).toEqual(['404']);
  });
});

describe('reaction ordering + early arrival', () => {
  it('keeps a reaction that arrives before its message and applies it on insert', () => {
    let state = roomsReducer(undefined, { type: '@@init' });
    state = roomsReducer(
      state,
      addRoom({ roomData: { jid: JID, name: 'r', title: 'r', messages: [], usersCnt: 1 } as any })
    );
    state = roomsReducer(
      state,
      setReactions({ roomJID: JID, messageId: '7', from: 'bob@h', reactions: ['+1'], latestReactionTimestamp: '200' })
    );
    state = roomsReducer(state, addRoomMessages({ roomJID: JID, messages: [msg('7')] }));
    expect(state.rooms[JID].messages[0].reaction?.bob?.emoji).toEqual(['+1']);
  });

  it('an older reaction from a later-loaded page does not override a newer one', () => {
    let state = seeded();
    const react = (reactions: string[], ts: string) =>
      (state = roomsReducer(
        state,
        setReactions({ roomJID: JID, messageId: '1', from: 'bob@h', reactions, latestReactionTimestamp: ts })
      ));
    react([], '300'); // newest: removed
    react(['heart'], '100'); // older page arrives afterwards
    const r = state.rooms[JID].messages[0].reaction?.bob;
    expect(r?.emoji).toEqual([]);
  });
});

describe('message insert never drops', () => {
  it('a message with the same timestamp as the last one is kept', () => {
    let state = seeded();
    const same = { ...msg('2'), id: '2b', date: '2026-05-15T10:00:00Z' } as IMessage;
    state = roomsReducer(state, addRoomMessages({ roomJID: JID, messages: [same] }));
    expect(state.rooms[JID].messages.map((m) => m.id)).toContain('2b');
  });
});
