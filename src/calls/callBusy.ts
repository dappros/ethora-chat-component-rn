import type { BusyCallSnapshot } from './callMode';

/**
 * The call slice as `decideIncomingWhileBusy` should see it. A call that
 * failed (phase 'error') only has its error card left on screen, waiting to
 * be dismissed; it must not make the phone refuse the next incoming call as
 * busy.
 */
export const busySnapshot = (call: BusyCallSnapshot): BusyCallSnapshot =>
  call.phase === 'error' ? { ...call, phase: 'idle' } : call;
