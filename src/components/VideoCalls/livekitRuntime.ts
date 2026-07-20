/**
 * Optional-dependency bridge for the LiveKit React Native SDK.
 *
 * Calls are opt-in (`config.videoCalls.enabled`), and the LiveKit packages
 * are NATIVE modules: they need a dev build, they cannot run in Expo Go,
 * and they add camera/microphone entitlements to whatever app installs
 * them. Most hosts embedding this chat SDK don't want calls at all, so
 * `@livekit/react-native` and `@livekit/react-native-webrtc` are declared
 * as OPTIONAL peer dependencies.
 *
 * That means a plain top-level `import ... from '@livekit/react-native'`
 * is not allowed anywhere in the SDK: Metro resolves imports at bundle
 * time, so a chat-only host would fail to build over a feature it never
 * switched on. Everything call-related goes through `loadLiveKit()`, which
 * requires the modules lazily at call time and returns null when they
 * aren't installed. Callers surface that as a friendly config error rather
 * than a redbox.
 */

export interface LiveKitRuntime {
  /** livekit-client `Room` constructor. */
  Room: any;
  /** livekit-client `RoomEvent` enum. */
  RoomEvent: any;
  /** livekit-client `Track` enum (Track.Source.Camera etc). */
  Track: any;
  /** livekit-client `ConnectionState` enum. */
  ConnectionState: any;
  /** RN `<VideoTrack trackRef={...} />` renderer. */
  VideoTrack: any;
  /** Native audio session control (routing, speaker, focus). */
  AudioSession: any;
  /** Installs the WebRTC globals livekit-client expects. */
  registerGlobals: () => void;
}

let cached: LiveKitRuntime | null | undefined;

export const isLiveKitAvailable = (): boolean => loadLiveKit() !== null;

/**
 * Resolve the LiveKit runtime, or null when the optional native packages
 * aren't installed in the host app. Result is memoised (including the
 * failure) so a missing dependency doesn't re-throw on every render.
 */
export const loadLiveKit = (): LiveKitRuntime | null => {
  if (cached !== undefined) {
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('@livekit/react-native');
    // `livekit-client` is a hard dependency of @livekit/react-native, so
    // if the first require succeeded this one will too. Read the enums
    // from it rather than from the RN wrapper: the wrapper re-exports a
    // moving subset across versions, the core package does not.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('livekit-client');

    cached = {
      Room: core.Room,
      RoomEvent: core.RoomEvent,
      Track: core.Track,
      ConnectionState: core.ConnectionState,
      VideoTrack: rn.VideoTrack,
      AudioSession: rn.AudioSession,
      registerGlobals: rn.registerGlobals,
    };
  } catch {
    cached = null;
  }

  return cached;
};

let globalsRegistered = false;

/**
 * `registerGlobals()` patches RTCPeerConnection / MediaStream / navigator
 * .mediaDevices onto the JS global scope so livekit-client (written for
 * browsers) works on React Native. It must run exactly once per JS
 * context, before the first `new Room()`. Calling it repeatedly is
 * harmless in current versions but has thrown in older ones, so guard it.
 */
export const ensureLiveKitGlobals = (runtime: LiveKitRuntime): void => {
  if (globalsRegistered) {return;}
  try {
    runtime.registerGlobals?.();
  } catch {
    // Already registered by the host app (it may use LiveKit elsewhere).
  }
  globalsRegistered = true;
};

/** Reset memoised state. Test seam only. */
export const __resetLiveKitRuntimeForTests = (): void => {
  cached = undefined;
  globalsRegistered = false;
};
