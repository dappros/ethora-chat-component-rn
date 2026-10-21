/**
 * What the call UI reads from the media session of the current call.
 *
 * Two transports fill the same snapshot: the LiveKit room
 * (callSessionController.ts) and the peer to peer connection
 * (p2pCallSession.ts), so the screen, the minimized strip, CallKit and the
 * ongoing-call notification never need to know which one carries the call.
 */

/**
 * One person in a group call grid. `video` is an opaque handle for
 * `<CallVideo source={...} />`, present only while a live, unmuted camera
 * track exists.
 */
export interface CallParticipantView {
  identity: string;
  name: string;
  isLocal: boolean;
  video: any;
  micMuted: boolean;
  speaking: boolean;
}

export interface CallSessionSnapshot {
  /** A media session (LiveKit room or p2p connection) exists for the current call. */
  active: boolean;
  connected: boolean;
  /** Translated, dismissible camera/mic problem. Never fails the call. */
  deviceError: string | null;
  micOn: boolean;
  cameraOn: boolean;
  speakerOn: boolean;
  /** Which camera the local video comes from; only the front one is mirrored. */
  facingMode: 'user' | 'environment';
  /**
   * Bumped whenever the local camera track is re-acquired, so the self view
   * can remount onto the new stream instead of holding the stopped one.
   */
  localVideoEpoch: number;
  /** Opaque video handle for `<CallVideo />`, live and unmuted only. */
  remoteVideo: any;
  localVideo: any;
  remoteName: string | null;
  remoteJoined: boolean;
  /** Peer joined but has no live microphone. */
  remoteMicMuted: boolean;
  /**
   * When the call truly connected: the later of the two LiveKit `joinedAt`
   * stamps (p2p: when media first flowed). The server sets the LiveKit ones,
   * so both sides count from the same moment (web's useSharedCallElapsed).
   * Null until the peer is in. In a group: when the first two were in.
   */
  anchorAt: number | null;
  /** Group room call: render `participants` as a grid. */
  isGroup: boolean;
  /** Everyone in a group call, local first. Empty for a 1:1 call. */
  participants: CallParticipantView[];
  /** p2p only: media was flowing and the connection is being restored. */
  reconnecting: boolean;
}

export const IDLE_SESSION: CallSessionSnapshot = {
  active: false,
  connected: false,
  deviceError: null,
  micOn: true,
  cameraOn: false,
  speakerOn: false,
  facingMode: 'user',
  localVideoEpoch: 0,
  remoteVideo: null,
  localVideo: null,
  remoteName: null,
  remoteJoined: false,
  remoteMicMuted: false,
  anchorAt: null,
  isGroup: false,
  participants: [],
  reconnecting: false,
};
