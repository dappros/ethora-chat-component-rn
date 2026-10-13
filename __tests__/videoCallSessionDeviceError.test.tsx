/**
 * callSessionController — the LiveKit session of a call.
 *
 * 1. Camera/mic failures must not abort the call. A device failure
 *    (permission denied, or no camera at all on the iOS Simulator) used to
 *    be caught by the same handler as a connect failure, so the call died
 *    before reaching "in-call". room.connect() failure is fatal; device
 *    failures are a dismissible deviceError.
 *
 * 2. The session must outlive the call UI. Minimizing swaps the Modal for a
 *    floating View, which remounts the session component; when the
 *    component owned the room, that disconnected and the peer hung up.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockRoomEvent = {
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  TrackPublished: 'trackPublished',
  TrackUnpublished: 'trackUnpublished',
  LocalTrackPublished: 'localTrackPublished',
  LocalTrackUnpublished: 'localTrackUnpublished',
  TrackMuted: 'trackMuted',
  TrackUnmuted: 'trackUnmuted',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  Disconnected: 'disconnected',
  MediaDevicesError: 'mediaDevicesError',
};

function makeFakeRoom(overrides: Partial<any> = {}) {
  const listeners: Record<string, Function[]> = {};
  const room: any = {
    listeners,
    remoteParticipants: new Map(),
    localParticipant: {
      getTrackPublication: () => null,
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Requested device not found'), {
            name: 'NotFoundError',
          })
        ),
      ...overrides.localParticipant,
    },
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    removeAllListeners: jest.fn(),
    on: jest.fn((event: string, fn: Function) => {
      (listeners[event] = listeners[event] || []).push(fn);
      return room;
    }),
    ...overrides,
  };
  return room;
}

jest.mock('../src/components/VideoCalls/livekitRuntime', () => ({
  __esModule: true,
  // Lazy: the refs are assigned in beforeEach, after this hoisted factory.
  loadLiveKit: () => ({
    Room: jest.fn(() => mockFakeRoomRef.current),
    RoomEvent: mockRoomEvent,
    Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
    ConnectionState: {},
    VideoTrack: () => null,
    AudioSession: {
      startAudioSession: jest.fn().mockResolvedValue(undefined),
      stopAudioSession: jest.fn().mockResolvedValue(undefined),
      setAppleAudioConfiguration: jest.fn().mockResolvedValue(undefined),
    },
    registerGlobals: jest.fn(),
  }),
  ensureLiveKitGlobals: jest.fn(),
  isLiveKitAvailable: () => true,
}));

jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockFakeRoomRef: { current: any };

import { Provider as ReduxProvider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  acceptIncomingCall,
  resetCall,
  setIncomingCallToken,
} from '../src/roomStore/callSlice';
import {
  __resetCallSessionForTests,
  startCallSession,
  switchCallCamera,
  useCallSession,
} from '../src/components/VideoCalls/callSessionController';
import { VideoCallSession } from '../src/components/VideoCalls/VideoCallSession';

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

// Put the call slice where a session belongs: an accepted incoming call.
const enterConnecting = () => {
  store.dispatch(
    setIncomingCallToken({
      roomJid: 'room@conference.example.com',
      roomName: 'Peer',
      roomBareName: 'room',
      token: 'fake-token',
      kind: 'video',
      callId: 'call-1',
      peerXmppUsername: 'peer',
    } as any)
  );
  store.dispatch(acceptIncomingCall());
};

const start = () =>
  startCallSession({
    token: 'fake-token',
    livekitUrl: 'wss://livekit.example.com',
    kind: 'video',
  });

describe('callSessionController', () => {
  beforeEach(() => {
    __resetCallSessionForTests();
    store.dispatch(resetCall());
    mockFakeRoomRef = { current: makeFakeRoom() };
  });

  it('reaches in-call when setCameraEnabled rejects (no camera on the iOS Simulator)', async () => {
    enterConnecting();
    start();
    await flush();

    const room = mockFakeRoomRef.current;
    expect(room.connect).toHaveBeenCalled();
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalled();
    expect(store.getState().call.phase).toBe('in-call');
    expect(store.getState().call.error).toBeFalsy();
  });

  it('fails the call when room.connect() itself fails', async () => {
    mockFakeRoomRef.current = makeFakeRoom({
      connect: jest.fn().mockRejectedValue(new Error('bad token')),
    });
    enterConnecting();
    start();
    await flush();

    expect(store.getState().call.phase).toBe('error');
    expect(store.getState().call.error).toContain('bad token');
  });

  it('keeps the room connected when the call UI remounts (minimize)', async () => {
    enterConnecting();
    start();
    await flush();
    const room = mockFakeRoomRef.current;

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <VideoCallSession kind="video" onHangup={jest.fn()} />
        </ReduxProvider>
      );
    });
    await act(async () => {
      tree.update(
        <ReduxProvider store={store}>
          <VideoCallSession kind="video" minimized onHangup={jest.fn()} />
        </ReduxProvider>
      );
    });
    await act(async () => {
      tree.unmount();
    });
    // Re-attaching from a remounted overlay must not open a second room.
    start();
    await flush();

    expect(room.disconnect).not.toHaveBeenCalled();
    expect(room.connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects as soon as the call slice ends the call', async () => {
    enterConnecting();
    start();
    await flush();
    const room = mockFakeRoomRef.current;

    store.dispatch(resetCall());

    expect(room.disconnect).toHaveBeenCalled();
  });

  it('ends the call when the peer leaves after having joined', async () => {
    enterConnecting();
    start();
    await flush();
    const room = mockFakeRoomRef.current;

    room.remoteParticipants.set('peer', {
      identity: 'peer',
      getTrackPublication: () => null,
    });
    room.listeners.participantConnected.forEach((fn: Function) => fn());
    room.remoteParticipants.clear();
    room.listeners.participantDisconnected.forEach((fn: Function) => fn());

    expect(store.getState().call.phase).toBe('idle');
    expect(room.disconnect).toHaveBeenCalled();
  });

  it('switches to the back camera by re-acquiring the track', async () => {
    // applyConstraints({ facingMode }) is a no-op in react-native-webrtc's
    // native code: the camera stayed front and only the mirror flipped.
    let facing = 'user';
    const cameraTrack = {
      restartTrack: jest.fn(async (options: any) => {
        facing = options.facingMode;
      }),
      mediaStreamTrack: {
        getSettings: () => ({ facingMode: facing }),
        applyConstraints: jest.fn(),
      },
    };
    mockFakeRoomRef.current = makeFakeRoom({
      localParticipant: {
        getTrackPublication: () => ({ track: cameraTrack }),
        setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      },
    });
    enterConnecting();
    start();
    await flush();

    let latest: any;
    const Probe = () => {
      latest = useCallSession();
      return null;
    };
    await act(async () => {
      renderer.create(<Probe />);
    });
    const epochBefore = latest.localVideoEpoch;

    await act(async () => {
      await switchCallCamera();
    });

    expect(cameraTrack.restartTrack).toHaveBeenCalledWith(
      expect.objectContaining({ facingMode: 'environment' })
    );
    expect(cameraTrack.mediaStreamTrack.applyConstraints).not.toHaveBeenCalled();
    expect(latest.facingMode).toBe('environment');
    expect(latest.localVideoEpoch).toBe(epochBefore + 1);
  });
});
