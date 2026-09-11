/**
 * isOwnMessage - pure helper.
 *
 * Bug #41: MAM catch-up messages briefly rendered on the RIGHT (as if
 * sent by the current user) before flipping to the LEFT once a later
 * update corrected `message.user.id`. The naive `message.user.id ===
 * walletAddress` comparison treats two empty/undefined ids as equal, and
 * also breaks when the same sender identity shows up in different
 * shapes (bare id vs. full JID vs. MUC occupant JID) depending on which
 * code path produced the message.
 */

import { isOwnMessage } from '../src/helpers/isOwnMessage';

describe('isOwnMessage - never matches on blank ids', () => {
  it('returns false when the message has no user id, even if currentUser is also blank', () => {
    expect(
      isOwnMessage({ user: { id: '' } } as any, { walletAddress: '' })
    ).toBe(false);
  });

  it('returns false when both message.user.id and currentUser are undefined', () => {
    expect(isOwnMessage(undefined, undefined)).toBe(false);
    expect(isOwnMessage({ user: { id: undefined } } as any, undefined)).toBe(
      false
    );
  });

  it('returns false when currentUser resolves to an empty id (no message.user id issue)', () => {
    expect(
      isOwnMessage({ user: { id: 'wallet-1' } } as any, {
        xmppUsername: '',
        walletAddress: '',
      })
    ).toBe(false);
  });

  it('returns false when message.user is missing entirely', () => {
    expect(isOwnMessage({} as any, 'wallet-1')).toBe(false);
    expect(isOwnMessage(null, 'wallet-1')).toBe(false);
  });
});

describe('isOwnMessage - matches the real owner', () => {
  it('matches a bare id against a currentUser object (xmppUsername preferred)', () => {
    expect(
      isOwnMessage({ user: { id: 'alice' } } as any, {
        xmppUsername: 'alice',
        walletAddress: 'wallet-alice',
      })
    ).toBe(true);
  });

  it('falls back to walletAddress when xmppUsername is absent', () => {
    expect(
      isOwnMessage({ user: { id: 'wallet-alice' } } as any, {
        walletAddress: 'wallet-alice',
      })
    ).toBe(true);
  });

  it('matches against a plain resolved id string (MessageContainer\'s `walletAddress` prop)', () => {
    expect(
      isOwnMessage({ user: { id: 'alice' } } as any, 'alice')
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      isOwnMessage({ user: { id: 'Alice' } } as any, 'alice')
    ).toBe(true);
  });
});

describe('isOwnMessage - normalizes JID shapes', () => {
  it('matches a bare JID (local@domain) against a bare id', () => {
    expect(
      isOwnMessage({ user: { id: 'alice@xmpp.host' } } as any, 'alice')
    ).toBe(true);
  });

  it('matches a bare JID with a trailing session resource, as senderJID carries on the wire', () => {
    // e.g. <data senderJID="alice@host/sessionResource"> - see test.xml.
    expect(
      isOwnMessage(
        { user: { id: 'alice@xmpp.host/1727188880221' } } as any,
        'alice'
      )
    ).toBe(true);
  });

  it('does not match a different user even after normalization', () => {
    expect(
      isOwnMessage({ user: { id: 'bob@xmpp.host/session' } } as any, 'alice')
    ).toBe(false);
  });
});

describe('isOwnMessage - does not match a genuinely different sender', () => {
  it('returns false for another user\'s message', () => {
    expect(
      isOwnMessage({ user: { id: 'bob' } } as any, {
        xmppUsername: 'alice',
        walletAddress: 'wallet-alice',
      })
    ).toBe(false);
  });
});
