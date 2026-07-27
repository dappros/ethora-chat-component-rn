/**
 * VideoCallSession — camera/mic failures must not abort the call.
 *
 * Regression: the connect effect used to share ONE try/catch across
 * room.connect() AND setMicrophoneEnabled()/setCameraEnabled(). A device
 * failure there — permission denied, or simply no camera hardware (every
 * iOS Simulator) — was caught by the same handler that treats a connect
 * failure as fatal, so onError fired and the call died before ever
 * reaching "connected". From the ring screen this reads exactly as
 * "tapped Accept, nothing happens" / "call connects but no video" —
 * because on the Simulator it doesn't even get that far.
 *
 * Fix: room.connect() failure is fatal (onError); setMicrophoneEnabled /
 * setCameraEnabled failures are soft (a dismissible deviceError, call
 * proceeds to onConnected regardless).
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { configureStore } from '@reduxjs/toolkit';
import { Provider as ReduxProvider } from 'react-redux';

const mockRoomEvent = {
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
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

jest.mock('../src/components/VideoCalls/livekitRuntime', () => {
  return {
    __esModule: true,
    // Lazy: mockFakeRoomRef/mockRoomEventRef are assigned in beforeEach,
    // AFTER this factory is registered (jest.mock is hoisted above the
    // `let` declarations) but BEFORE loadLiveKit() is actually invoked
    // (that happens inside the component's connect effect, well after
    // the test body has run). Reading `.current` here, not destructuring
    // it above, is what makes that ordering work.
    loadLiveKit: () => ({
      Room: jest.fn(() => mockFakeRoomRef.current),
      RoomEvent: mockRoomEventRef.current,
      Track: { Source: { Camera: 'camera' } },
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
  };
});

// Module-scope refs so the jest.mock factory (hoisted, can't close over
// outer-scope `let`s declared after it) can still reach per-test fakes.
let mockFakeRoomRef: { current: any };
let mockRoomEventRef: { current: any };

import { VideoCallSession } from '../src/components/VideoCalls/VideoCallSession';
import roomsReducer from '../src/roomStore/roomsSlice';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';

const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
  });

// Flush the connect effect's async chain (several microtask hops: the
// AudioSession start, room.connect, setMicrophoneEnabled, setCameraEnabled).
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe('VideoCallSession — device errors are non-fatal', () => {
  beforeEach(() => {
    mockFakeRoomRef = { current: makeFakeRoom() };
    mockRoomEventRef = { current: mockRoomEvent };
  });

  it('still calls onConnected when setCameraEnabled rejects (e.g. no camera on the iOS Simulator)', async () => {
    const onConnected = jest.fn();
    const onError = jest.fn();

    await act(async () => {
      renderer.create(
        <ReduxProvider store={makeStore()}>
          <VideoCallSession
            token="fake-token"
            livekitUrl="wss://livekit.example.com"
            kind="video"
            onConnected={onConnected}
            onError={onError}
            onHangup={jest.fn()}
          />
        </ReduxProvider>
      );
    });
    await flush();

    expect(mockFakeRoomRef.current.connect).toHaveBeenCalled();
    expect(mockFakeRoomRef.current.localParticipant.setCameraEnabled).toHaveBeenCalled();
    // The whole point of the fix: a camera failure must not be treated as
    // a connect failure.
    expect(onError).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalled();
  });

  it('does call onError when room.connect() itself fails (a real connect failure stays fatal)', async () => {
    mockFakeRoomRef.current = makeFakeRoom({
      connect: jest.fn().mockRejectedValue(new Error('bad token')),
    });
    const onConnected = jest.fn();
    const onError = jest.fn();

    await act(async () => {
      renderer.create(
        <ReduxProvider store={makeStore()}>
          <VideoCallSession
            token="fake-token"
            livekitUrl="wss://livekit.example.com"
            kind="video"
            onConnected={onConnected}
            onError={onError}
            onHangup={jest.fn()}
          />
        </ReduxProvider>
      );
    });
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('bad token'));
    expect(onConnected).not.toHaveBeenCalled();
  });
});
