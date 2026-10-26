import type { CallState } from '../../roomStore/callSlice';

/**
 * True while a call is far enough along to have a media session: connecting
 * or in the call. A LiveKit call also needs its token (that is what the room
 * is joined with); a peer to peer call has none, its media is the peer
 * connection, so the phase alone decides.
 */
export const callCanRenderSession = (
  call: Pick<CallState, 'phase' | 'mode' | 'token'>
): boolean =>
  (call.phase === 'connecting' || call.phase === 'in-call') &&
  (call.mode === 'p2p' || !!call.token);
