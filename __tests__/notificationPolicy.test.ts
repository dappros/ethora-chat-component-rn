import {
  isOwnIncomingMessage,
  shouldToastForRoom,
} from '../src/helpers/notificationPolicy';

const ROOM = 'react@conference.xmpp.example.com';

describe('in-app toast policy: whose message', () => {
  const user = { xmppUsername: 'appid_42', walletAddress: '0xABC' };
  const other = { user: { id: 'appid_7' } } as any;

  it('is own when the MUC nickname is our XMPP name (wallet is not in it)', () => {
    expect(
      isOwnIncomingMessage({
        message: other,
        stanzaFrom: `${ROOM}/appid_42`,
        senderJID: undefined,
        user,
      })
    ).toBe(true);
  });

  it('is own when senderJID is our full JID, whatever the case and resource', () => {
    expect(
      isOwnIncomingMessage({
        message: other,
        stanzaFrom: `${ROOM}/someone`,
        senderJID: 'AppId_42@xmpp.example.com/phone',
        user,
      })
    ).toBe(true);
  });

  it('is own when the parsed message user is us', () => {
    expect(
      isOwnIncomingMessage({
        message: { user: { id: 'appid_42@xmpp.example.com' } } as any,
        stanzaFrom: `${ROOM}/x`,
        user,
      })
    ).toBe(true);
  });

  it('is someone else otherwise, and never matches on blank ids', () => {
    expect(
      isOwnIncomingMessage({
        message: other,
        stanzaFrom: `${ROOM}/appid_7`,
        senderJID: 'appid_7@xmpp.example.com',
        user,
      })
    ).toBe(false);
    expect(
      isOwnIncomingMessage({ message: { user: {} } as any, stanzaFrom: ROOM, user: {} })
    ).toBe(false);
  });
});

describe('in-app toast policy: where and when', () => {
  it('never toasts for the chat that is open, even with a different case or resource', () => {
    expect(
      shouldToastForRoom({
        roomJID: `${ROOM}/nick`,
        visibleRoomJID: 'React@Conference.xmpp.example.com',
        appActive: true,
      })
    ).toBe(false);
  });

  it('toasts for another chat while the app is on screen', () => {
    expect(
      shouldToastForRoom({ roomJID: ROOM, visibleRoomJID: 'other@conf.x', appActive: true })
    ).toBe(true);
    expect(shouldToastForRoom({ roomJID: ROOM, visibleRoomJID: null, appActive: true })).toBe(
      true
    );
  });

  it('stays quiet for a muted chat and while the app is in the background', () => {
    expect(
      shouldToastForRoom({ roomJID: ROOM, visibleRoomJID: null, appActive: true, muted: true })
    ).toBe(false);
    expect(shouldToastForRoom({ roomJID: ROOM, visibleRoomJID: null, appActive: false })).toBe(
      false
    );
  });
});
