/**
 * P2PCallRunner: the headless owner of the p2p controller for the call in
 * the redux call slice (port of the web SDK's P2PCallRunner test, with the
 * React Native specifics: the WebRTC package check, the session bridge and
 * translated messages).
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';

const mockInstances: any[] = [];

jest.mock('../src/calls/p2p/P2PCallController', () => {
  const actual = jest.requireActual('../src/calls/p2p/P2PCallController');
  class FakeController {
    started = false;
    disposed = false;
    signals: any[] = [];
    start = jest.fn(async () => {
      this.started = true;
    });
    receive = jest.fn((s: any) => this.signals.push(s));
    dispose = jest.fn(() => {
      if (this.disposed) {return;}
      this.disposed = true;
      this.events.onDisposed?.({ started: this.started });
    });
    params: any;
    deps: any;
    events: any;
    timings: any;
    constructor(params: any, deps: any, events: any, timings: any) {
      this.params = params;
      this.deps = deps;
      this.events = events;
      this.timings = timings;
      mockInstances.push(this);
    }
  }
  return { ...actual, P2PCallController: FakeController };
});
jest.mock('../src/networking/api-requests/callState.api', () => ({
  reportCallRinging: jest.fn(),
  reportCallConnected: jest.fn(),
  reportCallEnded: jest.fn(),
  reportCallDeclined: jest.fn(),
  fetchIceServers: jest.fn(),
}));
jest.mock('../src/calls/p2p/webrtcRuntime', () => ({
  isP2PAvailable: jest.fn(() => true),
  loadWebRTC: jest.fn(() => null),
}));
jest.mock('../src/components/VideoCalls/p2pCallSession', () => ({
  bindP2PSession: jest.fn(() => jest.fn()),
  startP2PController: jest.fn(async (controller: any) => controller.start()),
  localizeP2PMessage: jest.requireActual('../src/components/VideoCalls/p2pCallSession')
    .localizeP2PMessage,
}));

import {
  reportCallConnected,
  reportCallDeclined,
  reportCallEnded,
  reportCallRinging,
} from '../src/networking/api-requests/callState.api';
import { isP2PAvailable } from '../src/calls/p2p/webrtcRuntime';
import { bindP2PSession } from '../src/components/VideoCalls/p2pCallSession';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import {
  acceptIncomingCall,
  endCall,
  setIncomingCallToken,
  setOutgoingCallRoute,
  startOutgoingCall,
} from '../src/roomStore/callSlice';
import { getActiveP2PController, p2pInbox } from '../src/calls/p2p/p2pRuntime';
import { P2PCallRunner } from '../src/components/VideoCalls/P2PCallRunner';

const call = () => store.getState().call;
const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

let tree: renderer.ReactTestRenderer | null = null;
const mount = async () => {
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <P2PCallRunner />
      </Provider>
    );
  });
};

describe('P2PCallRunner', () => {
  beforeEach(() => {
    mockInstances.length = 0;
    jest.clearAllMocks();
    (isP2PAvailable as jest.Mock).mockReturnValue(true);
    p2pInbox.clear();
    store.dispatch(endCall());
    store.dispatch(
      setConfig({ videoCalls: { enabled: true, livekitUrl: 'wss://lk' } } as any)
    );
  });
  afterEach(async () => {
    await act(async () => {
      tree?.unmount();
      tree = null;
      store.dispatch(endCall());
    });
    await tick();
  });

  const ringIncoming = (over: Record<string, unknown> = {}) =>
    store.dispatch(
      setIncomingCallToken({
        roomJid: 'a-b@conference.x',
        roomBareName: 'a-b',
        token: '',
        callId: 'c1',
        kind: 'audio',
        mode: 'p2p',
        peerXmppUsername: 'b',
        iceServers: [{ urls: 'stun:s' }],
        ...over,
      })
    );

  it('does nothing for a LiveKit call', async () => {
    await mount();
    await act(async () => {
      store.dispatch(setIncomingCallToken({ roomJid: 'r@c.x', token: 't', callId: 'l1' }));
    });
    await tick();
    expect(mockInstances).toHaveLength(0);
  });

  it('callee: builds the controller while ringing (to catch the offer), starts it only on accept', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
    });
    await tick();
    expect(mockInstances).toHaveLength(1);
    const c = mockInstances[0];
    expect(c.params).toMatchObject({
      callId: 'c1',
      role: 'callee',
      kind: 'audio',
      peerLocal: 'b',
      iceServers: [{ urls: 'stun:s' }],
    });
    expect(c.start).not.toHaveBeenCalled();
    expect(getActiveP2PController()).toBe(c);
    expect(reportCallRinging).toHaveBeenCalledWith('c1');
    expect(reportCallRinging).toHaveBeenCalledTimes(1);
    // The call screen reads the controller through the session bridge.
    expect(bindP2PSession).toHaveBeenCalledWith(c, 'audio');

    // Signals that arrive while ringing reach the same controller.
    p2pInbox.receive({
      callId: 'c1',
      signal: 'end',
      payload: {},
      fromBare: 'b@x',
      fromLocal: 'b',
      ageMs: null,
      delayed: false,
    });
    expect(c.receive).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.dispatch(acceptIncomingCall());
    });
    await tick();
    expect(mockInstances).toHaveLength(1); // same controller, not a second one
    expect(c.start).toHaveBeenCalledTimes(1);
    expect(c.disposed).toBe(false);
  });

  it('keeps the caller re-sending its offer for a cold-started callee', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
    });
    await tick();
    expect(mockInstances[0].timings.offerResendMs.length).toBeGreaterThan(2);
    expect(Math.max(...mockInstances[0].timings.offerResendMs)).toBeGreaterThan(10_000);
  });

  it('callee decline / ring ended: disposes without reporting an end', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
    });
    await tick();
    await act(async () => {
      store.dispatch(endCall());
    });
    await tick();
    const c = mockInstances[0];
    expect(c.dispose).toHaveBeenCalled();
    expect(reportCallEnded).not.toHaveBeenCalled();
    expect(getActiveP2PController()).toBeNull();
  });

  it('caller: starts as soon as the create response routes the call to p2p', async () => {
    await mount();
    await act(async () => {
      store.dispatch(
        startOutgoingCall({
          roomJid: 'a-b@conference.x',
          roomBareName: 'a-b',
          kind: 'video',
          peerXmppUsername: 'b',
        })
      );
    });
    await tick();
    expect(mockInstances).toHaveLength(0); // still dialling, transport unknown

    await act(async () => {
      store.dispatch(
        setOutgoingCallRoute({
          startedAt: call().startedAt,
          callId: 'c2',
          mode: 'p2p',
          iceServers: [{ urls: 'stun:s' }],
        })
      );
    });
    await tick();
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].params).toMatchObject({
      role: 'caller',
      callId: 'c2',
      kind: 'video',
    });
    expect(mockInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it('maps controller events onto the call state and reports to the server', async () => {
    await mount();
    await act(async () => {
      store.dispatch(
        startOutgoingCall({
          roomJid: 'a-b@conference.x',
          roomBareName: 'a-b',
          kind: 'video',
          peerXmppUsername: 'b',
        })
      );
      store.dispatch(
        setOutgoingCallRoute({
          startedAt: call().startedAt,
          callId: 'c3',
          mode: 'p2p',
          iceServers: [],
        })
      );
    });
    await tick();
    const c = mockInstances[0];

    await act(async () => c.events.onNegotiated());
    expect(call().phase).toBe('connecting');

    await act(async () => c.events.onConnected());
    expect(call().phase).toBe('in-call');
    expect(reportCallConnected).toHaveBeenCalledWith('c3');

    await act(async () => c.events.onRemoteEnd('hangup'));
    expect(call().phase).toBe('idle');
  });

  it('a failure ends in the error phase with the translated message, and the end is reported', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
      store.dispatch(acceptIncomingCall());
    });
    await tick();
    const c = mockInstances[0];
    await act(async () => c.events.onFailed('Camera or microphone permission denied'));
    expect(call()).toMatchObject({ phase: 'error' });
    expect(call().error).toMatch(/blocked/i);
    await tick();
    expect(c.dispose).toHaveBeenCalled();
    expect(reportCallEnded).toHaveBeenCalledWith('c1');
  });

  it('a peer-side media failure surfaces as an error, a plain hang up just closes', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
      store.dispatch(acceptIncomingCall());
    });
    await tick();
    await act(async () => mockInstances[0].events.onRemoteEnd('media-error'));
    expect(call().phase).toBe('error');
    expect(call().error).toMatch(/camera or microphone/i);
  });

  it('ignores late events of a call that is no longer the current one', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
      store.dispatch(acceptIncomingCall());
    });
    await tick();
    const c = mockInstances[0];
    await act(async () => {
      store.dispatch(endCall());
    });
    await act(async () => {
      ringIncoming({ callId: 'c-next' });
    });
    await act(async () => c.events.onFailed('late failure of the old call'));
    expect(call()).toMatchObject({ phase: 'ringing-incoming', callId: 'c-next' });
    await act(async () => c.events.onConnected());
    expect(call().phase).toBe('ringing-incoming');
  });

  it('unmounting releases the controller', async () => {
    await mount();
    await act(async () => {
      ringIncoming();
      store.dispatch(acceptIncomingCall());
    });
    await tick();
    const c = mockInstances[0];
    await act(async () => {
      tree?.unmount();
      tree = null;
    });
    await tick();
    expect(c.dispose).toHaveBeenCalled();
    expect(reportCallEnded).toHaveBeenCalledWith('c1');
  });

  it('a call without a known peer errors instead of hanging', async () => {
    await mount();
    await act(async () => {
      ringIncoming({ peerXmppUsername: null });
    });
    await tick();
    expect(call()).toMatchObject({ phase: 'error' });
    expect(call().error).toBe('Cannot reach the other participant');
    expect(mockInstances).toHaveLength(0);
  });

  it('a build without the WebRTC package fails the call and tells the caller', async () => {
    (isP2PAvailable as jest.Mock).mockReturnValue(false);
    await mount();
    await act(async () => {
      ringIncoming();
    });
    await tick();
    expect(call().phase).toBe('error');
    expect(call().error).toMatch(/not installed/i);
    expect(reportCallDeclined).toHaveBeenCalledWith('c1');
    expect(mockInstances).toHaveLength(0);
  });
});
