/**
 * Optional-dependency bridge for the WebRTC classes behind peer to peer calls.
 *
 * LiveKit's React Native SDK already ships a fork of react-native-webrtc,
 * `@livekit/react-native-webrtc`. The p2p path uses ITS RTCPeerConnection and
 * mediaDevices rather than adding the upstream `react-native-webrtc` package:
 * two copies of the WebRTC native classes in one app do not link. Like every
 * other call dependency it is an optional peer, so it is required lazily and
 * a host without it simply cannot take or place a p2p call (a call-token for
 * one is declined, see callTokenStanza).
 */

export interface WebRTCRuntime {
  /** `RTCPeerConnection` constructor of the fork. */
  RTCPeerConnection: any;
  /** `mediaDevices.getUserMedia` of the fork. */
  mediaDevices: any;
  /** `MediaStream` constructor of the fork. */
  MediaStream: any;
  /** `<RTCView streamURL={...} />` renderer. */
  RTCView: any;
  /**
   * `RTCAudioSession`: tells WebRTC when CallKit activates/deactivates the
   * iOS audio session. Null on builds that lack it.
   */
  RTCAudioSession: any;
}

let cached: WebRTCRuntime | null | undefined;

export const loadWebRTC = (): WebRTCRuntime | null => {
  if (cached !== undefined) {
    return cached;
  }
  try {
    const webrtc = require('@livekit/react-native-webrtc');
    if (!webrtc?.RTCPeerConnection || !webrtc?.mediaDevices) {
      cached = null;
    } else {
      cached = {
        RTCPeerConnection: webrtc.RTCPeerConnection,
        mediaDevices: webrtc.mediaDevices,
        MediaStream: webrtc.MediaStream,
        RTCView: webrtc.RTCView,
        RTCAudioSession: webrtc.RTCAudioSession ?? null,
      };
    }
  } catch {
    cached = null;
  }
  return cached;
};

/** True when this build can run a peer to peer call. */
export const isP2PAvailable = (): boolean => loadWebRTC() !== null;

/** Reset memoised state. Test seam only. */
export const __resetWebRTCRuntimeForTests = (): void => {
  cached = undefined;
};
