/**
 * A 1:1 chat showed "Members: 3" and four rows (each person twice): the
 * member list arrived with repeats and the server's usersCnt drifted to 3.
 */
import { uniqueMembers } from '../src/helpers/uniqueMembers';
import {
  getRoomUserCount,
  isRoomMembersTruncated,
} from '../src/helpers/roomUserCount';

describe('private room members', () => {
  it('drops repeated members, keeping the first', () => {
    const list = [
      { xmppUsername: 'a', firstName: 'Nick' },
      { xmppUsername: 'b', firstName: 'John' },
      { xmppUsername: 'b', firstName: 'John (dup)' },
      { xmppUsername: 'a', firstName: 'Nick (dup)' },
    ];
    expect(uniqueMembers(list).map((m) => m.firstName)).toEqual(['Nick', 'John']);
  });

  it('keys members by _id or jid when there is no xmppUsername', () => {
    const list = [{ _id: '1' }, { _id: '1' }, { jid: 'x@host' }, { jid: 'x@other' }];
    expect(uniqueMembers(list)).toHaveLength(2);
  });

  it('never counts more than two people in a private chat', () => {
    const room = { type: 'private', usersCnt: 3, members: [{}, {}] };
    expect(getRoomUserCount(room)).toBe(2);
    expect(isRoomMembersTruncated(room)).toBe(false);
  });

  it('still trusts usersCnt for a big group room', () => {
    const room = { type: 'group', usersCnt: 120, members: new Array(30).fill({}) };
    expect(getRoomUserCount(room)).toBe(120);
    expect(isRoomMembersTruncated(room)).toBe(true);
  });
});
