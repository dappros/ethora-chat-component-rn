/**
 * p2pCallSession: the peer to peer connection seen through the same session
 * snapshot as the LiveKit room, so the call screen, the minimized strip,
 * CallKit and the ongoing-call notification serve both transports.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';

const mockAudio = {
  startAudioSession: jest.fn().mockResolvedValue(undefined),
  stopAudioSession: jest.fn().mockResolvedValue(undefined),
  setAppleAudioConfiguration: jest.fn().mockResolvedValue(undefined),
  selectAudioOutput: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/components/VideoCalls/livekitRuntime', () => ({
  __esModule: true,
  loadLiveKit: () => ({ AudioSession: mockAudio }),
  ensureLiveKitGlobals: jest.fn(),
  isLiveKitAvailable: () => true,
}));

import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import type { P2PSnapshot } from '../src/calls/p2p/P2PCallController';
import {
  __resetP2PCallSessionForTests,
  bindP2PSession,
  dismissP2PDeviceError,
  getP2PSessionSnapshot,
  isP2PSessionActive,
  localizeP2PMessage,
  setP2PMicEnabled,
  startP2PController,
  switchP2PCamera,
  toggleP2PCamera,
  toggleP2PSpeaker,
  unbindP2PSession,
  useP2PSession,
} from '../src/components/VideoCalls/p2pCallSession';
import {
  __resetCallSessionForTests,
  setCallMicEnabled,
  toggleCallCamera,
  toggleCallMic,
  useCallSession,
} from '../src/components/VideoCalls/callSessionController';

const track = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'video',
  ...extra,
});

const stream = (url: string, videoIds: string[], extra: Record<string, unknown> = {}) =>
  ({
    toURL: () => url,
    getVideoTracks: () => videoIds.map((id) => track(id, extra)),
  }) as any;

class FakeController {
  snap: P2PSnapshot = {
    status: 'preparing',
    localStream: null,
    remoteStream: null,
    micEnabled: true,
    camEnabled: false,
    remoteVideoLive: false,
    notice: null,
  };
  listeners = new Set<() => void>();
  toggleMic = jest.fn(() => this.set({ micEnabled: !this.snap.micEnabled }));
  toggleCamera = jest.fn(async () => this.set({ camEnabled: !this.snap.camEnabled }));
  dismissNotice = jest.fn(() => this.set({ notice: null }));
  start = jest.fn(async () => {});
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snap;
  set(patch: Partial<P2PSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }
}

const bind = (kind: 'audio' | 'video' = 'video') => {
  const controller = new FakeController();
  const unbind = bindP2PSession(controller as any, kind);
  return { controller, unbind };
};

beforeEach(() => {
  __resetP2PCallSessionForTests();
  __resetCallSessionForTests();
  jest.clearAllMocks();
});

describe('binding a controller', () => {
  it('is idle until a controller is bound, and idle again after unbinding', () => {
    expect(isP2PSessionActive()).toBe(false);
    expect(getP2PSessionSnapshot().active).toBe(false);

    const { unbind } = bind();
    expect(isP2PSessionActive()).toBe(true);
    expect(getP2PSessionSnapshot().active).toBe(true);

    unbind();
    expect(isP2PSessionActive()).toBe(false);
    expect(getP2PSessionSnapshot().active).toBe(false);
    expect(mockAudio.stopAudioSession).toHaveBeenCalledTimes(1);
  });

  it('binding the same controller twice does not rebind', () => {
    const controller = new FakeController();
    const first = bindP2PSession(controller as any, 'video');
    const second = bindP2PSession(controller as any, 'video');
    expect(controller.listeners.size).toBe(1);
    second();
    expect(isP2PSessionActive()).toBe(false);
    first();
  });

  it('a stale unbind of a replaced controller does not drop the new one', () => {
    const a = new FakeController();
    const unbindA = bindP2PSession(a as any, 'video');
    const b = new FakeController();
    bindP2PSession(b as any, 'video');
    expect(a.listeners.size).toBe(0);
    unbindA();
    expect(isP2PSessionActive()).toBe(true);
  });
});

describe('status mapping', () => {
  it('says connecting while preparing and negotiating, waiting once the offer is out', () => {
    const { controller } = bind();
    expect(getP2PSessionSnapshot()).toMatchObject({
      connected: false,
      remoteJoined: false,
      anchorAt: null,
    });
    controller.set({ status: 'waiting' });
    expect(getP2PSessionSnapshot()).toMatchObject({ connected: true, remoteJoined: false });
    controller.set({ status: 'connecting' });
    expect(getP2PSessionSnapshot()).toMatchObject({ connected: false, remoteJoined: false });
  });

  it('anchors the timer when media first flows and keeps it across a reconnect', () => {
    const { controller } = bind();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(5_000);
    controller.set({ status: 'connected' });
    expect(getP2PSessionSnapshot()).toMatchObject({
      connected: true,
      remoteJoined: true,
      anchorAt: 5_000,
      reconnecting: false,
    });

    now.mockReturnValue(9_000);
    controller.set({ status: 'reconnecting' });
    expect(getP2PSessionSnapshot()).toMatchObject({
      remoteJoined: true,
      anchorAt: 5_000,
      reconnecting: true,
    });
    controller.set({ status: 'connected' });
    expect(getP2PSessionSnapshot()).toMatchObject({ anchorAt: 5_000, reconnecting: false });
    now.mockRestore();
  });

  it('mirrors the mic and camera, and an audio call never shows a camera', () => {
    const video = bind('video');
    video.controller.set({ micEnabled: false, camEnabled: true });
    expect(getP2PSessionSnapshot()).toMatchObject({ micOn: false, cameraOn: true });
    video.unbind();

    const audio = bind('audio');
    audio.controller.set({ camEnabled: true });
    expect(getP2PSessionSnapshot().cameraOn).toBe(false);
    expect(getP2PSessionSnapshot().localVideo).toBeNull();
  });

  it('defaults to the loudspeaker for video and the earpiece for audio', () => {
    bind('video');
    expect(getP2PSessionSnapshot().speakerOn).toBe(true);
    unbindP2PSession();
    bind('audio');
    expect(getP2PSessionSnapshot().speakerOn).toBe(false);
  });
});

describe('video handles for RTCView', () => {
  it('hands out the remote stream only while its video is live', () => {
    const { controller } = bind();
    const remote = stream('url-remote', ['rv1']);
    controller.set({ remoteStream: remote, remoteVideoLive: false });
    expect(getP2PSessionSnapshot().remoteVideo).toBeNull();

    controller.set({ remoteVideoLive: true });
    expect(getP2PSessionSnapshot().remoteVideo).toEqual({
      streamURL: 'url-remote',
      key: 'url-remote|rv1',
    });
  });

  it('keeps the same handle object while nothing changed, a new one when a track is swapped', () => {
    const { controller } = bind();
    controller.set({ remoteStream: stream('u', ['a']), remoteVideoLive: true });
    const first = getP2PSessionSnapshot().remoteVideo;
    controller.set({ micEnabled: false });
    expect(getP2PSessionSnapshot().remoteVideo).toBe(first);

    controller.set({ remoteStream: stream('u', ['b']) });
    expect(getP2PSessionSnapshot().remoteVideo).not.toBe(first);
    expect(getP2PSessionSnapshot().remoteVideo.key).toBe('u|b');
  });

  it('the camera turned off and on again remounts the view (new track id)', () => {
    const { controller } = bind();
    controller.set({ camEnabled: true, localStream: stream('lu', ['l1']) });
    expect(getP2PSessionSnapshot().localVideo.key).toBe('lu|l1');
    controller.set({ camEnabled: false });
    expect(getP2PSessionSnapshot().localVideo).toBeNull();
    controller.set({ camEnabled: true, localStream: stream('lu', ['l2']) });
    expect(getP2PSessionSnapshot().localVideo.key).toBe('lu|l2');
  });

  it('a stream without a video track or without a URL shows no video', () => {
    const { controller } = bind();
    controller.set({ remoteStream: stream('u', []), remoteVideoLive: true });
    expect(getP2PSessionSnapshot().remoteVideo).toBeNull();
    controller.set({
      remoteStream: { getVideoTracks: () => [track('x')] } as any,
      remoteVideoLive: true,
    });
    expect(getP2PSessionSnapshot().remoteVideo).toBeNull();
  });
});

describe('notices', () => {
  it('translates the controller\'s English notice into the device error', () => {
    const { controller } = bind();
    controller.set({ notice: 'Your camera or microphone is already in use by another app' });
    expect(getP2PSessionSnapshot().deviceError).toBe(
      'Your camera or microphone is already in use by another app.'
    );
  });

  it('keeps an unknown notice as it is, and dismissing clears it on the controller', () => {
    const { controller } = bind();
    controller.set({ notice: 'Something new from the web SDK' });
    expect(getP2PSessionSnapshot().deviceError).toBe('Something new from the web SDK');
    dismissP2PDeviceError();
    expect(controller.dismissNotice).toHaveBeenCalled();
    expect(getP2PSessionSnapshot().deviceError).toBeNull();
  });

  it('every message the controller can show has a translation', () => {
    const messages = [
      'Camera or microphone permission denied',
      'No camera or microphone found on this device',
      'Your camera or microphone is already in use by another app',
      'Could not access your camera or microphone',
      'The other person could not access their camera or microphone',
      'The call could not be connected',
      'Could not connect the call',
      'Could not start the call',
      'Could not set up the call',
      'Connection lost',
    ];
    store.dispatch(setConfig({ i18n: { locale: 'fr' } } as any));
    for (const message of messages) {
      // Translated, so different from the English the controller words it in.
      expect(localizeP2PMessage(message)).not.toBe(message);
    }
    store.dispatch(setConfig({ i18n: { locale: 'en' } } as any));
  });
});

describe('controls', () => {
  it('sets the mic to an absolute state without double toggling', () => {
    const { controller } = bind();
    setP2PMicEnabled(true);
    expect(controller.toggleMic).not.toHaveBeenCalled();
    setP2PMicEnabled(false);
    expect(controller.toggleMic).toHaveBeenCalledTimes(1);
    setP2PMicEnabled(false);
    expect(controller.toggleMic).toHaveBeenCalledTimes(1);
  });

  it('toggles the camera through the controller', async () => {
    const { controller } = bind();
    await toggleP2PCamera();
    expect(controller.toggleCamera).toHaveBeenCalledTimes(1);
    expect(getP2PSessionSnapshot().cameraOn).toBe(true);
  });

  it('flips to the back camera on the live local track and tracks the facing mode', () => {
    const { controller } = bind();
    const switchCamera = jest.fn();
    controller.set({
      camEnabled: true,
      localStream: stream('lu', ['l1'], { _switchCamera: switchCamera }),
    });
    switchP2PCamera();
    expect(switchCamera).toHaveBeenCalledTimes(1);
    expect(getP2PSessionSnapshot().facingMode).toBe('environment');
    switchP2PCamera();
    expect(getP2PSessionSnapshot().facingMode).toBe('user');
  });

  it('does nothing when there is no camera track to flip', () => {
    bind();
    switchP2PCamera();
    expect(getP2PSessionSnapshot().facingMode).toBe('user');
  });

  it('routes the speaker on iOS through the Apple audio configuration', async () => {
    const original = Platform.OS;
    (Platform as any).OS = 'ios';
    bind('video');
    await toggleP2PSpeaker();
    expect(mockAudio.setAppleAudioConfiguration).toHaveBeenLastCalledWith({
      audioCategory: 'playAndRecord',
      audioCategoryOptions: [],
      audioMode: 'voiceChat',
    });
    expect(getP2PSessionSnapshot().speakerOn).toBe(false);
    (Platform as any).OS = original;
  });

  it('routes the speaker on Android through selectAudioOutput, and rolls back on failure', async () => {
    const original = Platform.OS;
    (Platform as any).OS = 'android';
    bind('audio');
    await toggleP2PSpeaker();
    expect(mockAudio.selectAudioOutput).toHaveBeenCalledWith('speaker');
    expect(getP2PSessionSnapshot().speakerOn).toBe(true);

    mockAudio.selectAudioOutput.mockRejectedValueOnce(new Error('no route'));
    await toggleP2PSpeaker();
    expect(getP2PSessionSnapshot().speakerOn).toBe(true);
    (Platform as any).OS = original;
  });
});

describe('starting a call', () => {
  it('claims the audio session before the controller starts', async () => {
    const { controller } = bind('video');
    const order: string[] = [];
    mockAudio.startAudioSession.mockImplementationOnce(async () => {
      order.push('audio');
    });
    controller.start.mockImplementationOnce(async () => {
      order.push('start');
    });
    await startP2PController(controller as any, 'video');
    expect(order).toEqual(['audio', 'start']);
  });

  it('does not start a call that was cancelled while the audio session came up', async () => {
    const { controller, unbind } = bind('video');
    mockAudio.startAudioSession.mockImplementationOnce(async () => {
      unbind();
    });
    await startP2PController(controller as any, 'video');
    expect(controller.start).not.toHaveBeenCalled();
    // The session that was claimed is handed back.
    expect(mockAudio.stopAudioSession).toHaveBeenCalledTimes(2);
  });

  it('still starts when CallKit already owns the audio session', async () => {
    const { controller } = bind('audio');
    mockAudio.startAudioSession.mockRejectedValueOnce(new Error('session active'));
    await startP2PController(controller as any, 'audio');
    expect(controller.start).toHaveBeenCalledTimes(1);
  });
});

describe('the shared session API', () => {
  let latest: any;
  const Probe = () => {
    latest = useCallSession();
    return null;
  };
  const P2POnly = () => {
    useP2PSession();
    return null;
  };

  it('useCallSession serves the p2p call while one is bound, the room otherwise', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <>
          <Probe />
          <P2POnly />
        </>
      );
    });
    expect(latest.active).toBe(false);

    let controller: FakeController;
    await act(async () => {
      controller = bind('video').controller;
    });
    expect(latest.active).toBe(true);

    await act(async () => {
      controller.set({ status: 'connected', micEnabled: false });
    });
    expect(latest).toMatchObject({ connected: true, remoteJoined: true, micOn: false });

    await act(async () => {
      unbindP2PSession();
    });
    expect(latest.active).toBe(false);
    await act(async () => {
      tree.unmount();
    });
  });

  it('the shared mic and camera controls act on the p2p call', async () => {
    const { controller } = bind('video');
    await toggleCallMic();
    expect(controller.toggleMic).toHaveBeenCalledTimes(1);
    expect(controller.snap.micEnabled).toBe(false);

    await setCallMicEnabled(true);
    expect(controller.toggleMic).toHaveBeenCalledTimes(2);
    expect(controller.snap.micEnabled).toBe(true);

    await toggleCallCamera();
    expect(controller.toggleCamera).toHaveBeenCalledTimes(1);
  });
});
