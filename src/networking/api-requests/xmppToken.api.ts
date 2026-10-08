import http from '../apiClient';
import { store } from '../../roomStore';
import { setXmppPassword } from '../../roomStore/chatSettingsSlice';
import { secureUserStorage } from '../../helpers/secureUserStorage';
import type { User } from '../../types/types';

/**
 * POST /v1/users/xmpp-token: a fresh short-lived XMPP credential for the
 * logged-in user. It is the same value login and `users/me` put in
 * `user.xmppPassword` (the SASL password, a JWT), minted on demand, and the
 * endpoint exists for exactly one caller: a client reconnecting after the
 * credential it connected with has expired.
 *
 * Single-flight: several reconnect paths (error handler, watchdog, app
 * foregrounding) can ask at once and they should share one request.
 * Never throws: the caller falls back to whatever it had.
 */
let inFlight: Promise<string | null> | null = null;

export function fetchFreshXmppPassword(): Promise<string | null> {
  if (inFlight) {return inFlight;}

  const request = (async () => {
    try {
      const token = store.getState().chatSettingStore.user?.token || '';
      if (!token) {return null;}

      const response = await http.post<{
        success?: boolean;
        xmppPassword?: string;
      }>('/v1/users/xmpp-token', {}, { headers: { Authorization: token } });

      const fresh = response?.data?.xmppPassword;
      if (!fresh) {return null;}

      // Keep the store and the persisted session in step, so the next
      // reader (a full reconnect, a cold start) begins from the working
      // credential instead of the expired one. The reducer does not
      // persist (see refreshTokens); the awaited write here does.
      store.dispatch(setXmppPassword(fresh));
      try {
        await secureUserStorage().set(
          store.getState().chatSettingStore.user as User
        );
      } catch {
        // A failed write must not discard a credential that works now.
      }
      return fresh;
    } catch {
      return null;
    }
  })();

  // Cleared from OUTSIDE the async body: a `finally` inside it would run
  // synchronously on an early return, before `inFlight` is assigned, and
  // leave a settled promise cached forever.
  const tracked: Promise<string | null> = request.finally(() => {
    if (inFlight === tracked) {inFlight = null;}
  });
  inFlight = tracked;
  return tracked;
}
