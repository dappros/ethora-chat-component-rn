/**
 * Group calls over LiveKit: the session exposes everyone in the room, and
 * one person leaving does not end the call (a 1:1 call ends when its single
 * peer leaves). The 1:1 behaviour is pinned in videoCallSessionDeviceError.
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
  ActiveSpeakersChanged: 'activeSpeakersChanged',
  Disconnected: 'disconnected',
  MediaDevicesError: 'mediaDevicesError',
};

const mockTrack = { Source: { Camera: 'camera', Microphone: 'microphone' } };

function makeParticipant(identity: string, over: Record<string, unknown> = {}) {
  return {
    identity,
    name: `Name ${identity}`,
    joinedAt: new Date(1_000_000),
    getTrackPublication: () => null,
    ...over,
  };
}

function makeFakeRoom() {
  const listeners: Record<string, Function[]> = {};
  const room: any = {
    listeners,
    remoteParticipants: new Map(),
    activeSpeakers: [],
    localParticipant: {
      ...makeParticipant('me', { name: 'Me', joinedAt: new Date(1_000_000) }),
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
    },
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    removeAllListeners: jest.fn(),
    on: jest.fn((event: string, fn: Function) => {
      (listeners[event] = listeners[event] || []).push(fn);
      return room;
    }),
  };
  return room;
}

jest.mock('../src/components/VideoCalls/livekitRuntime', () => ({
  __esModule: true,
  loadLiveKit: () => ({
    Room: jest.fn(() => mockFakeRoomRef.current),
    RoomEvent: mockRoomEvent,
    Track: mockTrack,
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

let mockFakeRoomRef: { current: any };

import { store } from '../src/roomStore';
import {
  acceptIncomingCall,
  resetCall,
  setIncomingCallToken,
} from '../src/roomStore/callSlice';
import {
  __resetCallSessionForTests,
  startCallSession,
  useCallSession,
} from '../src/components/VideoCalls/callSessionController';

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const enterConnecting = (isGroup: boolean) =>
  act(async () => {
    store.dispatch(
      setIncomingCallToken({
        roomJid: 'room@conference.example.com',
        roomName: 'Design team',
        roomBareName: 'room',
        token: 'fake-token',
        kind: 'video',
        callId: 'call-1',
        isGroup,
      } as any)
    );
    store.dispatch(acceptIncomingCall());
  });

const start = (isGroup: boolean) =>
  act(async () => {
    startCallSession({
      token: 'fake-token',
      livekitUrl: 'wss://livekit.example.com',
      kind: 'video',
      isGroup,
    });
  });

const emitRoomEvent = (room: any, name: string) =>
  act(async () => {
    (room.listeners[name] || []).forEach((fn: Function) => fn());
  });

let latest: any;
const Probe = () => {
  latest = useCallSession();
  return null;
};

describe('callSessionController: group call', () => {
  let probe: renderer.ReactTestRenderer;
  afterEach(async () => {
    await act(async () => {
      probe.unmount();
      __resetCallSessionForTests();
      store.dispatch(resetCall());
    });
  });

  beforeEach(async () => {
    __resetCallSessionForTests();
    store.dispatch(resetCall());
    mockFakeRoomRef = { current: makeFakeRoom() };
    await act(async () => {
      probe = renderer.create(<Probe />);
    });
  });

  it('lists everyone in the room, us first, flagging the speaker and muted mics', async () => {
    await enterConnecting(true);
    await start(true);
    await flush();
    const room = mockFakeRoomRef.current;

    const ann = makeParticipant('ann', {
      getTrackPublication: (source: string) =>
        source === 'microphone' ? { isMuted: false } : null,
    });
    const bob = makeParticipant('bob');
    room.remoteParticipants.set('ann', ann);
    room.remoteParticipants.set('bob', bob);
    room.activeSpeakers = [ann];
    await emitRoomEvent(room, 'participantConnected');

    expect(latest.isGroup).toBe(true);
    expect(latest.participants.map((p: any) => p.identity)).toEqual(['me', 'ann', 'bob']);
    const byId = Object.fromEntries(latest.participants.map((p: any) => [p.identity, p]));
    expect(byId.me.isLocal).toBe(true);
    expect(byId.ann).toMatchObject({ speaking: true, micMuted: false, name: 'Name ann' });
    expect(byId.bob).toMatchObject({ speaking: false, micMuted: true });
    expect(latest.remoteJoined).toBe(true);
  });

  it('counts the call from when the first two were in, later joiners do not restart it', async () => {
    await enterConnecting(true);
    await start(true);
    await flush();
    const room = mockFakeRoomRef.current;

    room.remoteParticipants.set('ann', makeParticipant('ann', { joinedAt: new Date(1_050_000) }));
    await emitRoomEvent(room, 'participantConnected');
    expect(latest.anchorAt).toBe(1_000_000);

    room.remoteParticipants.set('bob', makeParticipant('bob', { joinedAt: new Date(2_000_000) }));
    await emitRoomEvent(room, 'participantConnected');
    expect(latest.anchorAt).toBe(1_000_000);
  });

  it('waits for others while alone in the room', async () => {
    await enterConnecting(true);
    await start(true);
    await flush();
    expect(latest.remoteJoined).toBe(false);
    expect(latest.anchorAt).toBeNull();
    expect(latest.participants).toHaveLength(1);
  });

  it('keeps the call when the last other member leaves; hanging up or a dropped room ends it', async () => {
    await enterConnecting(true);
    await start(true);
    await flush();
    const room = mockFakeRoomRef.current;

    room.remoteParticipants.set('ann', makeParticipant('ann'));
    await emitRoomEvent(room, 'participantConnected');
    room.remoteParticipants.clear();
    await emitRoomEvent(room, 'participantDisconnected');

    expect(store.getState().call.phase).not.toBe('idle');
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(latest.participants).toHaveLength(1);

    await emitRoomEvent(room, 'disconnected');
    expect(store.getState().call.phase).toBe('idle');
  });

  it('a 1:1 call still ends when its peer leaves', async () => {
    await enterConnecting(false);
    await start(false);
    await flush();
    const room = mockFakeRoomRef.current;

    room.remoteParticipants.set('peer', makeParticipant('peer'));
    await emitRoomEvent(room, 'participantConnected');
    expect(latest.isGroup).toBe(false);
    expect(latest.participants).toEqual([]);
    room.remoteParticipants.clear();
    await emitRoomEvent(room, 'participantDisconnected');

    expect(store.getState().call.phase).toBe('idle');
  });
});
