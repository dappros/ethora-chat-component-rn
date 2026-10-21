/**
 * The call overlay for the three kinds of call: a p2p 1:1 call (no LiveKit
 * token or URL), a group call, and the legacy LiveKit 1:1 call. Covers the
 * ring card wording and which screen a connecting call gets.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../src/components/VideoCalls/P2PCallRunner', () => ({
  P2PCallRunner: () => null,
}));
const mockStartCallSession = jest.fn();
jest.mock('../src/components/VideoCalls/callSessionController', () => ({
  __esModule: true,
  startCallSession: (...args: any[]) => mockStartCallSession(...args),
  useCallSession: () => ({
    active: true,
    connected: true,
    deviceError: null,
    micOn: true,
    cameraOn: false,
    speakerOn: false,
    facingMode: 'user',
    localVideoEpoch: 0,
    remoteVideo: null,
    localVideo: null,
    remoteName: null,
    remoteJoined: true,
    remoteMicMuted: false,
    anchorAt: null,
    isGroup: false,
    participants: [],
    reconnecting: false,
  }),
  toggleCallMic: jest.fn(),
  setCallMicEnabled: jest.fn(),
  toggleCallCamera: jest.fn(),
  switchCallCamera: jest.fn(),
  toggleCallSpeaker: jest.fn(),
  dismissCallDeviceError: jest.fn(),
}));
jest.mock('../src/components/VideoCalls/useCallKeep', () => ({ useCallKeep: () => undefined }));
jest.mock('../src/components/VideoCalls/livekitRuntime', () => ({
  __esModule: true,
  loadLiveKit: () => ({ VideoTrack: () => null, AudioSession: {} }),
  ensureLiveKitGlobals: jest.fn(),
  isLiveKitAvailable: () => true,
}));
jest.mock('../src/calls/p2p/webrtcRuntime', () => ({
  __esModule: true,
  loadWebRTC: () => null,
  isP2PAvailable: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));
jest.mock('../src/networking/api-requests/callState.api', () => ({
  reportCallDeclined: jest.fn(),
  reportCallEnded: jest.fn(),
  reportCallRinging: jest.fn(),
  reportCallConnected: jest.fn(),
  fetchIceServers: jest.fn(),
}));

import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import {
  resetCall,
  setCallPhase,
  setIncomingCallToken,
} from '../src/roomStore/callSlice';
import { VideoCallOverlay } from '../src/components/VideoCalls/VideoCallOverlay';
import { reportCallDeclined } from '../src/networking/api-requests/callState.api';
import { sendCallStateSignal } from '../src/networking/callTokenStanza';
import { declineActiveCall } from '../src/components/VideoCalls/callActions';

// The first render pulls in the whole call UI; give a cold run room.
jest.setTimeout(30_000);

let tree: renderer.ReactTestRenderer | null = null;
const mount = async () => {
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <VideoCallOverlay />
      </Provider>
    );
  });
  return tree!;
};

const texts = (t: renderer.ReactTestRenderer): string[] =>
  t.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''));

const configure = (livekitUrl = 'wss://lk') =>
  store.dispatch(
    setConfig({ videoCalls: { enabled: true, livekitUrl } } as any)
  );

beforeEach(() => {
  jest.clearAllMocks();
  store.dispatch(resetCall());
  configure();
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
    tree = null;
    store.dispatch(resetCall());
  });
});

const ring = (over: Record<string, unknown> = {}) =>
  act(async () => {
    store.dispatch(
      setIncomingCallToken({
        roomJid: 'a-b@conference.x',
        roomBareName: 'a-b',
        token: 'jwt',
        callId: 'c1',
        kind: 'video',
        ...over,
      } as any)
    );
  });

describe('ring card', () => {
  it('names a 1:1 caller', async () => {
    const t = await mount();
    await ring({ roomName: 'Alice' });
    expect(texts(t)).toEqual(
      expect.arrayContaining(['Incoming video call', 'Alice', 'Video call'])
    );
  });

  it('shows a neutral label, not "Unknown caller", when no name is known', async () => {
    const t = await mount();
    await ring({ roomName: null });
    expect(texts(t)).toContain('Incoming call');
    expect(texts(t)).not.toContain('Unknown caller');
  });

  it('never shows a raw chat name as the caller', async () => {
    const t = await mount();
    const raw = `${'a'.repeat(24)}_${'b'.repeat(24)}-${'a'.repeat(24)}_${'c'.repeat(24)}`;
    await ring({ roomName: raw });
    expect(texts(t)).not.toContain(raw);
    expect(texts(t)).toContain('Incoming call');
  });

  it('announces a group call by room and caller', async () => {
    const t = await mount();
    await ring({
      isGroup: true,
      kind: 'audio',
      roomName: 'Design team',
      callerName: 'Alice',
    });
    expect(texts(t)).toEqual(
      expect.arrayContaining([
        'Incoming group audio call',
        'Design team',
        'Alice is calling in Design team',
      ])
    );
  });

  it('falls back to the plain group label when the caller is not known', async () => {
    const t = await mount();
    await ring({ isGroup: true, roomName: 'Design team' });
    expect(texts(t)).toEqual(
      expect.arrayContaining(['Incoming group video call', 'Group video call'])
    );
  });
});

describe('which screen a connecting call gets', () => {
  it('a p2p call goes to the call screen without a LiveKit token or URL, and joins no room', async () => {
    configure('');
    const t = await mount();
    await ring({ token: '', mode: 'p2p', roomName: 'Alice' });
    await act(async () => {
      store.dispatch(setCallPhase('connecting'));
    });
    // The 1:1 call screen (stage + controls), not the ring card or an error.
    expect(
      t.root.findAll((n) => n.props.accessibilityLabel === 'Hang up' && !!n.props.onPress)
        .length
    ).toBeGreaterThan(0);
    expect(texts(t)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/missing livekitUrl/i)])
    );
    expect(mockStartCallSession).not.toHaveBeenCalled();
  });

  it('a LiveKit call joins the room, with the server\'s URL when it sent one', async () => {
    const t = await mount();
    void t;
    await ring({ livekitUrl: 'wss://from-stanza' });
    await act(async () => {
      store.dispatch(setCallPhase('connecting'));
    });
    expect(mockStartCallSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'jwt',
        livekitUrl: 'wss://from-stanza',
        isGroup: false,
      })
    );
  });

  it('a group call joins the room as a group', async () => {
    await mount();
    await ring({ isGroup: true, roomName: 'Design team' });
    await act(async () => {
      store.dispatch(setCallPhase('connecting'));
    });
    expect(mockStartCallSession).toHaveBeenCalledWith(
      expect.objectContaining({ isGroup: true })
    );
  });

  it('a LiveKit call with no URL anywhere shows the config error', async () => {
    configure('');
    const t = await mount();
    await ring({});
    await act(async () => {
      store.dispatch(setCallPhase('connecting'));
    });
    await act(async () => {
      store.dispatch({ type: 'call/setCallError', payload: '' });
    });
    expect(texts(t).join(' ')).toMatch(/missing livekitUrl/i);
  });
});

describe('declining', () => {
  it('a p2p call reports the decline to the server; a LiveKit call does not', async () => {
    await mount();
    await ring({ token: '', mode: 'p2p', peerXmppUsername: 'alice' });
    await act(async () => {
      declineActiveCall();
    });
    expect(reportCallDeclined).toHaveBeenCalledWith('c1');
    expect(sendCallStateSignal).toHaveBeenCalledWith('declined');
    expect(store.getState().call.phase).toBe('idle');

    jest.clearAllMocks();
    await ring({ callId: 'c2' });
    await act(async () => {
      declineActiveCall();
    });
    expect(reportCallDeclined).not.toHaveBeenCalled();
    expect(sendCallStateSignal).toHaveBeenCalledWith('declined');
  });
});
