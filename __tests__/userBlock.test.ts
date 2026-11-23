import {
  blockAccountOf,
  blockedIdOf,
  isPrivateRoomWithBlockedPeer,
  isUserBlockEnabled,
} from '../src/helpers/userBlock';

describe('user block helpers', () => {
  it('is opt-in and can be forced off', () => {
    expect(isUserBlockEnabled(undefined)).toBe(false);
    expect(isUserBlockEnabled({ features: { userBlock: true } } as any)).toBe(true);
    expect(isUserBlockEnabled({ features: { userBlock: true }, disableUserBlock: true } as any)).toBe(false);
  });

  it('compares on the user id part of prefixed and bare ids', () => {
    expect(blockedIdOf('646cc8dc_abc123@xmpp.example.com')).toBe('abc123');
    expect(blockedIdOf('646cc8dc_abc123')).toBe('abc123');
    expect(blockedIdOf('abc123')).toBe('abc123');
    expect(blockedIdOf(undefined)).toBe('');
  });

  it('finds private rooms with a blocked peer, never by the own id', () => {
    const room = {
      type: 'private',
      members: [{ xmppUsername: 'app_me' }, { xmppUsername: 'app_peer' }],
    };
    expect(isPrivateRoomWithBlockedPeer(room, ['peer'], 'app_me')).toBe(true);
    expect(isPrivateRoomWithBlockedPeer(room, ['someone'], 'app_me')).toBe(false);
    expect(isPrivateRoomWithBlockedPeer(room, ['me'], 'app_me')).toBe(false);
    expect(isPrivateRoomWithBlockedPeer({ ...room, type: 'group' }, ['peer'], 'app_me')).toBe(false);
    // REST rows: bare ids in _id
    expect(
      isPrivateRoomWithBlockedPeer({ type: 'private', members: [{ _id: 'peer' }] }, ['peer'], 'app_me')
    ).toBe(true);
  });

  it('sends the peer with the app prefix the backend resolves', () => {
    // REST room members and profiles carry the bare user id
    expect(blockAccountOf('6ac92069', '646cc8dc_6ada1a1f')).toBe('646cc8dc_6ac92069');
    expect(blockAccountOf('6ac92069', '646cc8dc_646cc8dc_6ada1a1f@xmpp.example.com')).toBe('646cc8dc_6ac92069');
    expect(blockAccountOf('646cc8dc_6ac92069@xmpp.example.com', '646cc8dc_6ada1a1f')).toBe('646cc8dc_6ac92069');
    expect(blockAccountOf('6ac92069', undefined)).toBe('6ac92069');
    expect(blockAccountOf('', '646cc8dc_6ada1a1f')).toBe('');
  });
});
