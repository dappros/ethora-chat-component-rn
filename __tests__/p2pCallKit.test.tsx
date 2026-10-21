/**
 * A p2p call rings and is answered through the same CallKit / ConnectionService
 * path as a LiveKit call: it appears under callKitUuid(callId), Answer and
 * Decline from the system screen drive the call, a decline reaches the server
 * (REST report, since there is no LiveKit webhook) and the caller, and iOS
 * audio activation reaches the WebRTC audio session even without LiveKit's JS.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';

const mockCallKeep = {
  setup: jest.fn().mockResolvedValue(undefined),
  setAvailable: jest.fn(),
  displayIncomingCall: jest.fn(),
  startCall: jest.fn(),
  answerIncomingCall: jest.fn(),
  reportConnectingOutgoingCallWithUUID: jest.fn(),
  reportConnectedOutgoingCallWithUUID: jest.fn(),
  setMutedCall: jest.fn(),
  endCall: jest.fn(),
  endAllCalls: jest.fn(),
  backToForeground: jest.fn(),
  listeners: {} as Record<string, Function>,
  addEventListener: jest.fn((event: string, fn: Function) => {
    mockCallKeep.listeners[event] = fn;
  }),
  removeEventListener: jest.fn(),
};
jest.mock('react-native-callkeep', () => mockCallKeep, { virtual: true });

jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));
// The system-screen decline waits for the socket (declineActiveCallWhenOnline).
jest.mock('../src/utils/clientRegistry', () => ({
  __esModule: true,
  getGlobalXmppClient: () => ({ status: 'online' }),
}));
jest.mock('../src/networking/api-requests/callState.api', () => ({
  reportCallDeclined: jest.fn(),
  reportCallEnded: jest.fn(),
  reportCallRinging: jest.fn(),
  reportCallConnected: jest.fn(),
  fetchIceServers: jest.fn(),
}));

const mockRTCAudioSession = {
  audioSessionDidActivate: jest.fn(),
  audioSessionDidDeactivate: jest.fn(),
};
// A p2p-only build: no LiveKit JS, only the WebRTC fork.
jest.mock('../src/components/VideoCalls/livekitRuntime', () => ({
  __esModule: true,
  loadLiveKit: () => null,
  ensureLiveKitGlobals: jest.fn(),
  isLiveKitAvailable: () => false,
}));
jest.mock('../src/calls/p2p/webrtcRuntime', () => ({
  __esModule: true,
  loadWebRTC: () => ({ RTCAudioSession: mockRTCAudioSession }),
  isP2PAvailable: () => true,
}));
jest.mock('../src/components/VideoCalls/callSessionController', () => ({
  __esModule: true,
  useCallSession: () => ({ micOn: true, cameraOn: true, connected: true, anchorAt: null }),
  setCallMicEnabled: jest.fn(),
}));

import { Provider as ReduxProvider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  resetCall,
  setIncomingCallToken,
} from '../src/roomStore/callSlice';
import { useCallKeep } from '../src/components/VideoCalls/useCallKeep';
import { callKitUuid } from '../src/components/VideoCalls/systemCall';
import { reportCallDeclined } from '../src/networking/api-requests/callState.api';
import { sendCallStateSignal } from '../src/networking/callTokenStanza';

const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const Probe = () => {
  useCallKeep();
  return null;
};

let tree: renderer.ReactTestRenderer | null = null;
const mount = async () => {
  await act(async () => {
    tree = renderer.create(
      <ReduxProvider store={store}>
        <Probe />
      </ReduxProvider>
    );
  });
  await flush();
};

const ringP2P = (over: Record<string, unknown> = {}) =>
  act(async () => {
    store.dispatch(
      setIncomingCallToken({
        roomJid: 'a-b@conference.x',
        roomBareName: 'a-b',
        roomName: 'Alice',
        token: '',
        callId: 'c-p2p',
        kind: 'video',
        mode: 'p2p',
        peerXmppUsername: 'alice',
        ...over,
      } as any)
    );
  });

beforeAll(() => {
  (NativeModules as any).RNCallKeep = {};
});

beforeEach(() => {
  jest.clearAllMocks();
  store.dispatch(resetCall());
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
    tree = null;
    store.dispatch(resetCall());
  });
});

describe('a p2p call on the system call screen', () => {
  it('rings as a CallKit call named after the caller, under the callId\'s UUID', async () => {
    await mount();
    await ringP2P();
    expect(mockCallKeep.displayIncomingCall).toHaveBeenCalledWith(
      callKitUuid('c-p2p'),
      'Alice',
      'Alice',
      'generic',
      true
    );
  });

  it('Answer on the system screen accepts the call', async () => {
    await mount();
    await ringP2P();
    await act(async () => {
      mockCallKeep.listeners.answerCall({ callUUID: callKitUuid('c-p2p') });
    });
    expect(store.getState().call).toMatchObject({
      phase: 'connecting',
      mode: 'p2p',
      callId: 'c-p2p',
    });
    expect(mockCallKeep.backToForeground).toHaveBeenCalled();
  });

  it('Decline on the system screen tells the server and the caller, and ends the ring', async () => {
    await mount();
    await ringP2P();
    await act(async () => {
      mockCallKeep.listeners.endCall({ callUUID: callKitUuid('c-p2p') });
    });
    expect(reportCallDeclined).toHaveBeenCalledWith('c-p2p');
    expect(sendCallStateSignal).toHaveBeenCalledWith(
      'declined',
      expect.objectContaining({ callId: 'c-p2p', peerXmppUsername: 'alice' })
    );
    expect(store.getState().call.phase).toBe('idle');
  });

  it('declining a LiveKit call does not send the p2p REST report', async () => {
    await mount();
    await ringP2P({ mode: 'livekit', token: 'jwt', callId: 'c-lk' });
    await act(async () => {
      mockCallKeep.listeners.endCall({ callUUID: callKitUuid('c-lk') });
    });
    expect(reportCallDeclined).not.toHaveBeenCalled();
    expect(sendCallStateSignal).toHaveBeenCalledWith(
      'declined',
      expect.objectContaining({ callId: 'c-lk' })
    );
  });

  it('hands the audio session to WebRTC when LiveKit\'s JS is not there', async () => {
    await mount();
    await act(async () => {
      mockCallKeep.listeners.didActivateAudioSession();
      mockCallKeep.listeners.didDeactivateAudioSession();
    });
    expect(mockRTCAudioSession.audioSessionDidActivate).toHaveBeenCalledTimes(1);
    expect(mockRTCAudioSession.audioSessionDidDeactivate).toHaveBeenCalledTimes(1);
  });
});
