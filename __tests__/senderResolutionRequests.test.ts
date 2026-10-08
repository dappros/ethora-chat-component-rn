/**
 * Where the RN code asks the shared resolver for unknown senders: search hits
 * (resolveSender) and live messages (onRealtimeMessage).
 */
const mockRequestUsers = jest.fn();
const mockRequestSendersOf = jest.fn();
jest.mock('../src/helpers/userResolver', () => ({
  requestUsers: (ids: string[]) => mockRequestUsers(ids),
  requestSendersOf: (m: unknown[]) => mockRequestSendersOf(m),
}));

import { xml } from '@xmpp/client';
import { store } from '../src/roomStore';
import { addRoom } from '../src/roomStore/roomsSlice';
import { resolveSender } from '../src/components/Modals/MessageSearchModal/resolveSender';
import { onRealtimeMessage } from '../src/networking/stanzaHandlers';

beforeEach(() => {
  mockRequestUsers.mockClear();
  mockRequestSendersOf.mockClear();
});

describe('resolveSender asks the resolver when no name resolves', () => {
  const hit = { from: 'app1_user1@xmpp.example.com', fromUserId: 'user1' };

  it('requests the local part of an unresolved sender', () => {
    expect(resolveSender(hit, { usersSet: {} }).name).toBe('');
    expect(mockRequestUsers).toHaveBeenCalledWith(['app1_user1']);
  });

  it('does not request a sender usersSet already knows', () => {
    const usersSet = { app1_user1: { firstName: 'Ada', lastName: 'L' } };
    expect(resolveSender(hit, { usersSet }).name).toBe('Ada L');
    expect(mockRequestUsers).not.toHaveBeenCalled();
  });

  it('does not request the signed-in user', () => {
    resolveSender(hit, { usersSet: {}, myXmppUsername: 'app1_user1' });
    expect(mockRequestUsers).not.toHaveBeenCalled();
  });
});

describe('onRealtimeMessage requests the sender of a live message', () => {
  it('passes the stored message to requestSendersOf', async () => {
    const ROOM = 'room@conference.h';
    store.dispatch(
      addRoom({ roomData: { jid: ROOM, name: 'room', messages: [] } as any })
    );
    await onRealtimeMessage(
      xml(
        'message',
        { type: 'groupchat', from: `${ROOM}/app1_user9`, id: 'live-1' },
        xml('data', { senderJID: 'app1_user9@h' }),
        xml('body', {}, 'hi')
      ) as any
    );
    expect(mockRequestSendersOf).toHaveBeenCalledTimes(1);
    expect(mockRequestSendersOf.mock.calls[0][0][0].user.id).toBe('app1_user9');
  });
});
