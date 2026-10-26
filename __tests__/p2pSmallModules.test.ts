/**
 * Small pieces around the p2p call: the busy snapshot, the decline report,
 * the session-render rule, and the native deps of a controller.
 */

import { busySnapshot } from '../src/calls/callBusy';
import { callCanRenderSession } from '../src/components/VideoCalls/callLive';

jest.mock('../src/networking/api-requests/callState.api', () => ({
  reportCallDeclined: jest.fn(),
  reportCallEnded: jest.fn(),
  reportCallRinging: jest.fn(),
  reportCallConnected: jest.fn(),
  fetchIceServers: jest.fn(),
}));
import { reportCallDeclined } from '../src/networking/api-requests/callState.api';
import { reportDeclineIfP2P } from '../src/calls/declineReport';

describe('busySnapshot', () => {
  const base = {
    phase: 'in-call',
    direction: 'incoming' as const,
    mode: 'p2p' as const,
    callId: 'c',
    roomBareName: 'r',
  };

  it('leaves a running call as it is', () => {
    expect(busySnapshot(base)).toBe(base);
    expect(busySnapshot({ ...base, phase: 'ringing-incoming' }).phase).toBe('ringing-incoming');
  });

  it('treats a failed call (only its error card left) as idle', () => {
    const idle = busySnapshot({ ...base, phase: 'error' });
    expect(idle.phase).toBe('idle');
    expect(idle.callId).toBe('c');
  });
});

describe('reportDeclineIfP2P', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports a p2p decline', () => {
    reportDeclineIfP2P({ mode: 'p2p', callId: 'c1' });
    expect(reportCallDeclined).toHaveBeenCalledWith('c1');
  });

  it('never reports for a LiveKit call', () => {
    reportDeclineIfP2P({ mode: 'livekit', callId: 'c1' });
    expect(reportCallDeclined).not.toHaveBeenCalled();
  });
});

describe('callCanRenderSession', () => {
  it('a LiveKit call needs its token, a p2p call does not', () => {
    expect(callCanRenderSession({ phase: 'connecting', mode: 'livekit', token: 't' })).toBe(true);
    expect(callCanRenderSession({ phase: 'in-call', mode: 'livekit', token: null })).toBe(false);
    expect(callCanRenderSession({ phase: 'connecting', mode: 'p2p', token: '' })).toBe(true);
    expect(callCanRenderSession({ phase: 'in-call', mode: 'p2p', token: null })).toBe(true);
  });

  it('only while connecting or in the call', () => {
    for (const phase of ['idle', 'requesting', 'ringing-incoming', 'error'] as const) {
      expect(callCanRenderSession({ phase, mode: 'p2p', token: 't' })).toBe(false);
    }
  });
});

describe('createNativeP2PDeps and the WebRTC runtime', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const loadDeps = (webrtc: unknown) => {
    jest.doMock('@livekit/react-native-webrtc', () => webrtc, { virtual: true });
    const runtime = require('../src/calls/p2p/webrtcRuntime');
    runtime.__resetWebRTCRuntimeForTests();
    return {
      runtime,
      p2pRuntime: require('../src/calls/p2p/p2pRuntime'),
    };
  };

  it('reports the fork as unavailable when it is not installed', () => {
    jest.doMock('@livekit/react-native-webrtc', () => {
      throw new Error('Cannot find module');
    }, { virtual: true });
    const runtime = require('../src/calls/p2p/webrtcRuntime');
    runtime.__resetWebRTCRuntimeForTests();
    expect(runtime.loadWebRTC()).toBeNull();
    expect(runtime.isP2PAvailable()).toBe(false);
  });

  it('a package without the connection classes does not count as available', () => {
    const { runtime } = loadDeps({ RTCView: () => null });
    expect(runtime.isP2PAvailable()).toBe(false);
  });

  it('builds connections, media and streams from the fork\'s classes', async () => {
    const created: any[] = [];
    class FakePeerConnection {
      config: any;
      constructor(config: any) {
        this.config = config;
        created.push(this);
      }
    }
    class FakeStream {}
    const getUserMedia = jest.fn().mockResolvedValue('media');
    const { runtime, p2pRuntime } = loadDeps({
      RTCPeerConnection: FakePeerConnection,
      MediaStream: FakeStream,
      mediaDevices: { getUserMedia },
      RTCView: () => null,
      RTCAudioSession: {},
    });
    expect(runtime.isP2PAvailable()).toBe(true);

    const deps = p2pRuntime.createNativeP2PDeps({ callId: 'c1', peerXmppUsername: 'bob' });
    const pc = deps.createPeerConnection({ iceServers: [] });
    expect(pc).toBeInstanceOf(FakePeerConnection);
    expect(created[0].config).toEqual({ iceServers: [] });
    expect(deps.createMediaStream()).toBeInstanceOf(FakeStream);
    await expect(deps.getUserMedia({ audio: true })).resolves.toBe('media');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('without the fork each use fails with a clear error instead of crashing at import', () => {
    jest.doMock('@livekit/react-native-webrtc', () => {
      throw new Error('Cannot find module');
    }, { virtual: true });
    const runtime = require('../src/calls/p2p/webrtcRuntime');
    runtime.__resetWebRTCRuntimeForTests();
    const { createNativeP2PDeps } = require('../src/calls/p2p/p2pRuntime');
    const deps = createNativeP2PDeps({ callId: 'c1', peerXmppUsername: 'bob' });
    expect(() => deps.createPeerConnection({})).toThrow('WebRTC is not available');
    expect(() => deps.createMediaStream()).toThrow('WebRTC is not available');
    expect(() => deps.getUserMedia({ audio: true })).toThrow('WebRTC is not available');
  });

  it('refreshes TURN credentials from the REST endpoint, null when there are none', async () => {
    const { p2pRuntime } = loadDeps({
      RTCPeerConnection: class {},
      MediaStream: class {},
      mediaDevices: { getUserMedia: jest.fn() },
    });
    const { fetchIceServers: mockedFetch } = require('../src/networking/api-requests/callState.api');
    const deps = p2pRuntime.createNativeP2PDeps({ callId: 'c1', peerXmppUsername: 'bob' });

    mockedFetch.mockResolvedValueOnce({
      enabled: true,
      iceServers: [{ urls: 'turn:t', username: 'u', credential: 'p' }],
      ttlSeconds: 60,
    });
    await expect(deps.fetchIceServers()).resolves.toEqual([
      { urls: 'turn:t', username: 'u', credential: 'p' },
    ]);
    mockedFetch.mockResolvedValueOnce({ enabled: false, iceServers: [], ttlSeconds: null });
    await expect(deps.fetchIceServers()).resolves.toBeNull();
    mockedFetch.mockResolvedValueOnce(null);
    await expect(deps.fetchIceServers()).resolves.toBeNull();
  });
});
