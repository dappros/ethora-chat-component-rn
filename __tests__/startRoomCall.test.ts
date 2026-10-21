/**
 * Joining a scheduled call is the room's ordinary call start, on a user tap.
 */

const mockCreateChatCall = jest.fn();
jest.mock('../src/networking/api-requests/rooms.api', () => ({
  __esModule: true,
  createChatCall: (...a: unknown[]) => mockCreateChatCall(...a),
}));
const mockInvite = jest.fn();
jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallInviteSignal: (...a: unknown[]) => mockInvite(...a),
  sendCallStateSignal: jest.fn(),
}));

import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { addRoom, deleteAllRooms } from '../src/roomStore/roomsSlice';
import {
  endCall,
  setIncomingCallToken,
} from '../src/roomStore/callSlice';
import { startRoomCall } from '../src/booking/startRoomCall';

const JID = 'app_room1@conference.xmpp.test';

beforeEach(() => {
  mockCreateChatCall.mockReset().mockResolvedValue({
    callId: 'c1',
    mode: 'p2p',
    kind: 'video',
    group: null,
    livekitUrl: null,
    iceServers: [],
    ttlSeconds: null,
  });
  mockInvite.mockReset();
  store.dispatch(endCall());
  store.dispatch(deleteAllRooms());
  store.dispatch(
    setConfig({ videoCalls: { enabled: true, livekitUrl: 'wss://x' } } as any)
  );
  store.dispatch(setUser({ token: 't', xmppUsername: 'app_me' } as any));
  store.dispatch(
    addRoom({
      roomData: {
        jid: JID,
        name: 'room1',
        title: 'Alex',
        type: 'private',
        messages: [],
        members: [
          { xmppUsername: 'app_me', firstName: 'Me' },
          { xmppUsername: 'app_alex', firstName: 'Alex', lastName: 'K' },
        ],
      } as any,
    } as any)
  );
});

it('starts the call for the room and signals the peer', async () => {
  expect(await startRoomCall(JID, 'video')).toBe('started');
  expect(store.getState().call).toMatchObject({
    phase: 'requesting',
    kind: 'video',
    roomJid: JID,
    roomBareName: 'app_room1',
    peerXmppUsername: 'app_alex',
  });
  expect(mockCreateChatCall).toHaveBeenCalledWith('app_room1', { kind: 'video' });
  expect(mockInvite).toHaveBeenCalledWith('video', {
    peerXmppUsername: 'app_alex',
    roomBareName: 'app_room1',
  });
});

it('takes the bare room name too', async () => {
  expect(await startRoomCall('app_room1', 'audio')).toBe('started');
  expect(store.getState().call.kind).toBe('audio');
});

it('answers the call that is already ringing in this room', async () => {
  store.dispatch(
    setIncomingCallToken({ roomJid: JID, roomBareName: 'app_room1', token: 'lk' })
  );
  expect(await startRoomCall(JID, 'video')).toBe('answered');
  expect(store.getState().call.phase).toBe('connecting');
  expect(mockCreateChatCall).not.toHaveBeenCalled();
});

it('is busy during another call', async () => {
  store.dispatch(
    setIncomingCallToken({ roomJid: 'other_room@conference.x', roomBareName: 'other_room', token: 'lk' })
  );
  expect(await startRoomCall(JID, 'video')).toBe('busy');
  expect(mockCreateChatCall).not.toHaveBeenCalled();
});

it('does nothing when calls are off', async () => {
  store.dispatch(setConfig({} as any));
  expect(await startRoomCall(JID, 'video')).toBe('disabled');
  expect(store.getState().call.phase).toBe('idle');
});

it('reports a failed start and leaves the error on the call', async () => {
  mockCreateChatCall.mockRejectedValue(new Error('Error creating chat call'));
  expect(await startRoomCall(JID, 'video')).toBe('failed');
  expect(store.getState().call.phase).toBe('error');
});

it('starts a group room call without a peer and flags it as a group call', async () => {
  const GROUP = 'app_team@conference.xmpp.test';
  mockCreateChatCall.mockResolvedValue({
    callId: 'c2',
    mode: 'livekit',
    kind: 'video',
    group: true,
    livekitUrl: null,
    iceServers: [],
    ttlSeconds: null,
  });
  store.dispatch(
    addRoom({
      roomData: {
        jid: GROUP,
        name: 'team',
        title: 'Team',
        type: 'group',
        messages: [],
        members: [
          { xmppUsername: 'app_me', firstName: 'Me' },
          { xmppUsername: 'app_alex', firstName: 'Alex' },
          { xmppUsername: 'app_bo', firstName: 'Bo' },
        ],
      } as any,
    } as any)
  );
  expect(await startRoomCall(GROUP, 'video')).toBe('started');
  expect(store.getState().call).toMatchObject({
    roomBareName: 'app_team',
    peerXmppUsername: null,
    isGroup: true,
  });
  expect(mockInvite).not.toHaveBeenCalled();
  expect(mockCreateChatCall).toHaveBeenCalledWith('app_team', { kind: 'video' });
});
