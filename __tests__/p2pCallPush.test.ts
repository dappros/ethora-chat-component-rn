/**
 * Incoming call pushes for the new call kinds: a p2p call (empty callToken,
 * mode=p2p) and a group call (group=true). They ring through the same VoIP
 * push / CallKit path as a LiveKit call.
 */

jest.mock('../src/networking/api-requests/callState.api', () => ({
  reportCallDeclined: jest.fn(),
  reportCallEnded: jest.fn(),
  reportCallRinging: jest.fn(),
  reportCallConnected: jest.fn(),
  fetchIceServers: jest.fn(),
}));
jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));
jest.mock('../src/components/VideoCalls/systemCall', () => ({
  __esModule: true,
  endSystemIncomingCall: jest.fn(),
  callKitUuid: (seed: string) => `uuid-${seed}`,
}));

import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import { addRoom } from '../src/roomStore/roomsSlice';
import {
  acceptIncomingCall,
  resetCall,
  setIncomingCallToken,
  startOutgoingCall,
  setCallPhase,
  setOutgoingCallToken,
} from '../src/roomStore/callSlice';
import {
  reportCallDeclined,
  reportCallEnded,
} from '../src/networking/api-requests/callState.api';
import { sendCallStateSignal } from '../src/networking/callTokenStanza';
import { endSystemIncomingCall } from '../src/components/VideoCalls/systemCall';
import {
  __resetCallPushForTests,
  answerCallFromPush,
  handleCallPush,
} from '../src/helpers/incomingCallFromPush';
import { isCallPush, parseCallPush } from '../src/helpers/callPush';
import { callPushDataOf } from '../src/push/sealedPushTask';

const p2pPush = {
  type: 'call',
  callId: 'c-p2p',
  callToken: '',
  room: 'appid_alice-appid_bob',
  kind: 'video',
  callerName: 'Alice',
  callerXmppUsername: 'appid_alice',
  mode: 'p2p',
  group: 'false',
};

const groupPush = {
  type: 'call',
  callId: 'c-group',
  callToken: 'jwt',
  room: 'appid_group-uuid',
  kind: 'video',
  callerName: 'Alice',
  callerXmppUsername: 'appid_alice',
  mode: 'livekit',
  group: 'true',
};

const configure = () =>
  store.dispatch(
    setConfig({
      videoCalls: { enabled: true, livekitUrl: 'wss://lk' },
      xmppSettings: { conference: 'conference.xmpp.example.com' },
    } as any)
  );

beforeEach(() => {
  jest.clearAllMocks();
  __resetCallPushForTests();
  store.dispatch(resetCall());
  store.dispatch(setConfig(undefined));
  configure();
});

describe('parseCallPush: mode and group', () => {
  it('reads the p2p mode and an empty token', () => {
    expect(parseCallPush(p2pPush)).toMatchObject({
      callId: 'c-p2p',
      token: null,
      mode: 'p2p',
      isGroup: false,
      callerXmppUsername: 'appid_alice',
    });
  });

  it('reads the group flag', () => {
    expect(parseCallPush(groupPush)).toMatchObject({ mode: 'livekit', isGroup: true });
  });

  it('an older push service sends neither: a plain LiveKit 1:1 call', () => {
    const { mode, group, ...legacy } = { ...p2pPush, callToken: 'jwt' };
    void mode;
    void group;
    expect(parseCallPush(legacy)).toMatchObject({ mode: 'livekit', isGroup: false });
  });

  it('an empty-token p2p push is still recognised as a call push', () => {
    expect(isCallPush(p2pPush)).toBe(true);
    expect(callPushDataOf({ data: p2pPush })).toBeTruthy();
  });
});

describe('a p2p call push', () => {
  it('rings with no token, as p2p, naming the caller', () => {
    expect(handleCallPush(p2pPush)).toBe(true);
    expect(store.getState().call).toMatchObject({
      phase: 'ringing-incoming',
      direction: 'incoming',
      mode: 'p2p',
      isGroup: false,
      token: '',
      callId: 'c-p2p',
      kind: 'video',
      roomName: 'Alice',
      peerXmppUsername: 'appid_alice',
      roomJid: 'appid_alice-appid_bob@conference.xmpp.example.com',
    });
    expect(endSystemIncomingCall).not.toHaveBeenCalled();
  });

  it('a LiveKit push without a token still does not ring', () => {
    handleCallPush({ ...p2pPush, mode: 'livekit' });
    expect(store.getState().call.phase).toBe('idle');
    expect(endSystemIncomingCall).toHaveBeenCalledWith('c-p2p');
  });

  it('a p2p push without a callId cannot be answered and does not ring', () => {
    handleCallPush({ ...p2pPush, callId: '', callKind: 'video' });
    expect(store.getState().call.phase).toBe('idle');
  });

  it('answer from the system screen goes straight to connecting', () => {
    answerCallFromPush(p2pPush);
    expect(store.getState().call).toMatchObject({
      phase: 'connecting',
      mode: 'p2p',
      callId: 'c-p2p',
    });
  });

  it('a second push for the same call does not restart the ring', () => {
    handleCallPush(p2pPush);
    const startedAt = store.getState().call.startedAt;
    handleCallPush(p2pPush);
    expect(store.getState().call.startedAt).toBe(startedAt);
    expect(reportCallDeclined).not.toHaveBeenCalled();
  });

  it('while in another call: declined to the caller (REST and XMPP), system call ended', () => {
    store.dispatch(
      setIncomingCallToken({
        roomJid: 'other@conference.x',
        token: 't',
        callId: 'other',
      })
    );
    store.dispatch(acceptIncomingCall());
    store.dispatch(setCallPhase('in-call'));

    expect(handleCallPush(p2pPush)).toBe(true);

    expect(store.getState().call.callId).toBe('other');
    expect(reportCallDeclined).toHaveBeenCalledWith('c-p2p');
    expect(sendCallStateSignal).toHaveBeenCalledWith(
      'declined',
      expect.objectContaining({ peerXmppUsername: 'appid_alice', callId: 'c-p2p' })
    );
    expect(endSystemIncomingCall).toHaveBeenCalledWith('c-p2p');
  });

  it('a call that failed and only shows its error card does not make the phone busy', () => {
    store.dispatch(
      setIncomingCallToken({ roomJid: 'x@conference.x', token: 't', callId: 'old' })
    );
    store.dispatch(acceptIncomingCall());
    store.dispatch({ type: 'call/setCallError', payload: 'boom' });
    expect(store.getState().call.phase).toBe('error');

    handleCallPush(p2pPush);
    expect(store.getState().call).toMatchObject({
      phase: 'ringing-incoming',
      callId: 'c-p2p',
    });
    expect(reportCallDeclined).not.toHaveBeenCalled();
  });

  it('both sides dialled at once: the smaller callId wins on both ends', () => {
    const dial = (callId: string) => {
      store.dispatch(resetCall());
      store.dispatch(
        startOutgoingCall({
          roomJid: 'appid_alice-appid_bob@conference.xmpp.example.com',
          roomBareName: 'appid_alice-appid_bob',
          kind: 'video',
          peerXmppUsername: 'appid_alice',
        })
      );
      store.dispatch({
        type: 'call/setOutgoingCallRoute',
        payload: {
          startedAt: store.getState().call.startedAt,
          callId,
          mode: 'p2p',
          iceServers: [],
        },
      });
    };

    // Ours has the larger id: we yield and ring for theirs.
    dial('z-9');
    handleCallPush({ ...p2pPush, callId: 'a-1' });
    expect(store.getState().call).toMatchObject({
      direction: 'incoming',
      phase: 'ringing-incoming',
      callId: 'a-1',
    });
    expect(reportCallEnded).toHaveBeenCalledWith('z-9');
    expect(sendCallStateSignal).toHaveBeenCalledWith('cancelled');

    // Ours has the smaller id: we keep dialling and drop their ring.
    jest.clearAllMocks();
    dial('a-1');
    handleCallPush({ ...p2pPush, callId: 'z-9' });
    expect(store.getState().call).toMatchObject({ direction: 'outgoing', callId: 'a-1' });
    expect(endSystemIncomingCall).toHaveBeenCalledWith('z-9');
    expect(reportCallDeclined).not.toHaveBeenCalled();
  });
});

describe('a LiveKit push while a p2p call is on', () => {
  it('is not allowed to replace it', () => {
    handleCallPush(p2pPush);
    store.dispatch(acceptIncomingCall());
    expect(store.getState().call.mode).toBe('p2p');

    handleCallPush({ ...groupPush, callId: 'c-other' });

    expect(store.getState().call).toMatchObject({ callId: 'c-p2p', mode: 'p2p' });
    expect(endSystemIncomingCall).toHaveBeenCalledWith('c-other');
  });
});

describe('a group call push', () => {
  beforeEach(() => {
    store.dispatch(
      addRoom({
        roomData: {
          jid: 'appid_group-uuid@conference.xmpp.example.com',
          name: 'Design team',
          type: 'group',
          usersCnt: 6,
        } as any,
      })
    );
  });

  it('rings for the ROOM, names the caller separately, and has no single peer', () => {
    handleCallPush(groupPush);
    expect(store.getState().call).toMatchObject({
      phase: 'ringing-incoming',
      mode: 'livekit',
      isGroup: true,
      token: 'jwt',
      roomName: 'Design team',
      callerName: 'Alice',
      callerXmppUsername: 'appid_alice',
      peerXmppUsername: null,
    });
  });

  it('a held group push rings the same once the chat is configured', () => {
    store.dispatch(setConfig(undefined));
    handleCallPush(groupPush);
    expect(store.getState().call.phase).toBe('idle');
    configure();
    expect(store.getState().call).toMatchObject({ isGroup: true, callId: 'c-group' });
  });
});

describe('outgoing calls are untouched', () => {
  it('a push for the call we are dialling does not become an incoming ring', () => {
    store.dispatch(
      startOutgoingCall({
        roomJid: 'appid_alice-appid_bob@conference.xmpp.example.com',
        roomBareName: 'appid_alice-appid_bob',
        kind: 'video',
      })
    );
    store.dispatch(
      setOutgoingCallToken({
        roomJid: 'appid_alice-appid_bob@conference.xmpp.example.com',
        token: 't',
        callId: 'c-livekit',
      })
    );
    handleCallPush({ ...groupPush, room: 'appid_alice-appid_bob', group: 'false', callId: 'c-livekit' });
    expect(store.getState().call.direction).toBe('outgoing');
  });
});
