import { reportCallDeclined } from '../networking/api-requests/callState.api';

/**
 * A peer to peer call has no LiveKit webhook, so the server learns that the
 * callee rejected it (and relays that to the caller) only from this report.
 * Never sent for a LiveKit call, where a REST decline would act on the
 * LiveKit room. REST needs no socket, so it can go out at once.
 */
export const reportDeclineIfP2P = (call: {
  mode: string;
  callId: string | null;
}): void => {
  if (call.mode === 'p2p') {
    reportCallDeclined(call.callId);
  }
};
