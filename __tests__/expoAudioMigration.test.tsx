/**
 * expo-av → expo-audio migration contract.
 *
 * expo-av is discontinued and does not work on RN 0.86 / New Architecture
 * (Expo SDK 57), so voice messages moved to expo-audio. The two APIs are
 * not drop-in compatible and the mismatches fail SILENTLY — which is
 * exactly what these tests pin:
 *
 *   • expo-audio reports playback times in SECONDS; expo-av used
 *     milliseconds. Feeding seconds into the millisecond-based UI would
 *     render every voice message as "0:00 / 0:00" with a dead progress
 *     bar, and nothing would throw.
 *   • expo-av's `createAsync({shouldPlay:true})` started playback itself;
 *     expo-audio's `createAudioPlayer` does not — a missing `play()` call
 *     leaves the button stuck with no sound and no error.
 *   • the audio-mode keys were renamed (`playsInSilentModeIOS` →
 *     `playsInSilentMode`, `allowsRecordingIOS` → `allowsRecording`).
 *     Unknown keys are ignored, and expo-audio's recorder additionally
 *     REFUSES to start when `allowsRecording` is not set.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';

type FakePlayer = ReturnType<typeof makePlayer>;

// `mock`-prefixed so jest.mock's factory may close over them (the factory
// is hoisted above these declarations, so it must read them lazily).
const mockPlayerRef: { current: FakePlayer | null } = { current: null };
const mockRecorderRef: { current: any } = { current: null };
const mockSetAudioModeAsync = jest.fn(async (_mode: any) => {});
const mockRequestRecordingPermissions = jest.fn(async () => ({
  granted: true,
  status: 'granted',
}));
const mockCreateAudioPlayer = jest.fn(() => mockPlayerRef.current);

jest.mock('expo-audio', () => ({
  __esModule: true,
  RecordingPresets: {
    HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100 },
    LOW_QUALITY: { extension: '.m4a', sampleRate: 44100 },
  },
  setAudioModeAsync: (mode: any) => mockSetAudioModeAsync(mode),
  requestRecordingPermissionsAsync: () => mockRequestRecordingPermissions(),
  createAudioPlayer: (...args: any[]) => (mockCreateAudioPlayer as any)(...args),
  useAudioRecorder: () => mockRecorderRef.current,
}));

// Sibling expo modules these two components import at module scope. They
// ship untranspiled TS entry points that Jest can't parse, and neither is
// exercised by the paths under test (a non-http audio src skips the
// download pipeline entirely).
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///caches/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  downloadAsync: jest.fn(async () => ({ status: 200, uri: '' })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  UIImagePickerControllerQualityType: { Medium: 1 },
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 1 },
}));
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('react-native-webview', () => ({
  __esModule: true,
  WebView: () => null,
}));
jest.mock('expo-video', () => ({
  __esModule: true,
  useVideoPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  VideoView: () => null,
}));
jest.mock('expo-image-manipulator', () => ({
  __esModule: true,
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///out.jpg' })),
  SaveFormat: { JPEG: 'jpeg' },
}));

// Imported AFTER the mock so the components bind to the doubles.
import AudioMessage from '../src/components/styled/AudioMessage';
import SendInput from '../src/components/styled/SendInput';

function makePlayer() {
  const listeners: ((status: any) => void)[] = [];
  return {
    listeners,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async (_seconds: number) => {}),
    remove: jest.fn(),
    addListener: jest.fn((_event: string, cb: (status: any) => void) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    }),
    emit(status: any) {
      listeners.forEach((cb) => cb(status));
    },
  };
}

function makeRecorder() {
  return {
    prepareToRecordAsync: jest.fn(async (_options?: any) => {}),
    record: jest.fn(),
    stop: jest.fn(async () => {}),
    uri: 'file:///caches/ExpoAudio/recording-abc123.m4a',
  };
}

// Several microtask hops separate the button press from the player being
// created (prepareSource → withTimeout → setAudioModeAsync).
const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const pressByTestID = async (tree: renderer.ReactTestRenderer, testID: string) => {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  // Fire and flush, but do NOT await the handler's own promise: for
  // playback it only settles once a status event arrives, which the test
  // emits afterwards.
  await act(async () => {
    void node.props.onPress();
  });
};

const textsOf = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .flatMap((t) => (Array.isArray(t.props.children) ? t.props.children : [t.props.children]))
    .filter((c): c is string => typeof c === 'string');

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayerRef.current = makePlayer();
  mockRecorderRef.current = makeRecorder();
});

describe('AudioMessage playback on expo-audio', () => {
  // A non-http src skips the download/sniff pipeline and goes straight
  // to the native player, which is the path under test here.
  const LOCAL_SRC = 'file:///caches/voice-1.m4a';

  const renderAudio = async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <AudioMessage src={LOCAL_SRC} mimeType="audio/m4a" fileName="voice-1.m4a" />
        </Provider>
      );
    });
    return tree!;
  };

  it('starts playback explicitly — createAudioPlayer does not auto-play', async () => {
    const tree = await renderAudio();
    const player = mockPlayerRef.current!;

    await pressByTestID(tree, 'audio-play-button');
    await flush();

    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(
      { uri: LOCAL_SRC },
      expect.objectContaining({ updateInterval: expect.any(Number) })
    );
    // Still waiting for the first `isLoaded` status: nothing plays yet.
    expect(player.play).not.toHaveBeenCalled();

    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 0, duration: 10, playing: false, didJustFinish: false });
    });
    await flush();

    expect(player.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('converts expo-audio SECONDS into the millisecond-based UI', async () => {
    const tree = await renderAudio();
    const player = mockPlayerRef.current!;

    await pressByTestID(tree, 'audio-play-button');
    await flush();

    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 0, duration: 75, playing: false, didJustFinish: false });
    });
    await flush();
    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 3, duration: 75, playing: true, didJustFinish: false });
    });

    const labels = textsOf(tree);
    // 3s → "0:03" and 75s → "1:15". Passing seconds through unconverted
    // would render "0:00" for both and leave the bar pinned at zero.
    expect(labels).toContain('0:03');
    expect(labels).toContain('1:15');
    expect(labels).not.toContain('Audio unavailable');

    await act(async () => {
      tree.unmount();
    });
  });

  it('pauses and resumes without waiting for a status event', async () => {
    const tree = await renderAudio();
    const player = mockPlayerRef.current!;

    await pressByTestID(tree, 'audio-play-button');
    await flush();
    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 0, duration: 10, playing: false, didJustFinish: false });
    });
    await flush();
    // The periodic time observer is the only thing that reports `playing`.
    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 2, duration: 10, playing: true, didJustFinish: false });
    });

    await pressByTestID(tree, 'audio-play-button');
    expect(player.pause).toHaveBeenCalledTimes(1);

    // expo-audio's pause() emits nothing and the observer stops, so if the
    // component waited for a status event it would latch on "pause" and
    // this second press would call pause() again instead of resuming.
    await pressByTestID(tree, 'audio-play-button');
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.pause).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('rewinds to the start when the clip finishes', async () => {
    const tree = await renderAudio();
    const player = mockPlayerRef.current!;

    await pressByTestID(tree, 'audio-play-button');
    await flush();
    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 0, duration: 10, playing: false, didJustFinish: false });
    });
    await flush();

    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 10, duration: 10, playing: false, didJustFinish: true });
    });

    // expo-av did this via setStatusAsync({shouldPlay:false, positionMillis:0});
    // expo-audio needs pause() + seekTo(0) in SECONDS.
    expect(player.pause).toHaveBeenCalled();
    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(textsOf(tree)).toContain('0:00');

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses the renamed audio-mode key and releases the native player on unmount', async () => {
    const tree = await renderAudio();
    const player = mockPlayerRef.current!;

    await pressByTestID(tree, 'audio-play-button');
    await flush();
    await act(async () => {
      player.emit({ isLoaded: true, currentTime: 0, duration: 10, playing: false, didJustFinish: false });
    });
    await flush();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ playsInSilentMode: true })
    );
    // The expo-av spelling would be silently ignored by expo-audio.
    expect(mockSetAudioModeAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ playsInSilentModeIOS: expect.anything() })
    );

    await act(async () => {
      tree.unmount();
    });
    // Native shared objects are not GC'd with the component.
    expect(player.remove).toHaveBeenCalled();
  });
});

describe('SendInput voice recording on expo-audio', () => {
  const renderInput = async (sendMedia: jest.Mock) => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <SendInput
            sendMessage={jest.fn()}
            sendMedia={sendMedia}
            isLoading={false}
            config={{ enableAudio: true } as any}
          />
        </Provider>
      );
    });
    return tree!;
  };

  it('records and sends a voice message through the expo-audio recorder', async () => {
    jest.useFakeTimers();
    try {
      const sendMedia = jest.fn(async () => {});
      const tree = await renderInput(sendMedia);
      const recorder = mockRecorderRef.current;

      await pressByTestID(tree, 'chat-record-button');
      await flush();

      expect(mockRequestRecordingPermissions).toHaveBeenCalled();
      // Without allowsRecording:true expo-audio's recorder throws
      // RecordingDisabledException from record().
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: true, playsInSilentMode: true })
      );
      // Preparing WITH the preset forces a fresh output file per take;
      // preparing bare would reuse the previous recording's URL.
      expect(recorder.prepareToRecordAsync).toHaveBeenCalledWith(
        expect.objectContaining({ extension: '.m4a' })
      );
      expect(recorder.record).toHaveBeenCalledTimes(1);

      // Let the elapsed-time interval push past the sub-1s discard guard.
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });

      await pressByTestID(tree, 'chat-send-button');
      await flush();

      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(sendMedia).toHaveBeenCalledWith(
        {
          uri: 'file:///caches/ExpoAudio/recording-abc123.m4a',
          type: 'audio/m4a',
          name: expect.stringMatching(/^voice-\d+\.m4a$/),
        },
        'audio/m4a'
      );
      // Mic released: the session must go back to playback-only.
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: false })
      );

      await act(async () => {
        tree.unmount();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('discards on cancel — stops the recorder without uploading', async () => {
    jest.useFakeTimers();
    try {
      const sendMedia = jest.fn(async () => {});
      const tree = await renderInput(sendMedia);
      const recorder = mockRecorderRef.current;

      await pressByTestID(tree, 'chat-record-button');
      await flush();
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });

      await pressByTestID(tree, 'chat-record-cancel');
      await flush();

      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(sendMedia).not.toHaveBeenCalled();

      await act(async () => {
        tree.unmount();
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
