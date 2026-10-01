import { store } from '../roomStore';
import { refreshAuthTokensQuietly } from './authRefresh';
import { fetchFreshXmppPassword } from './api-requests/xmppToken.api';
import {
  applyResolvedUserToStore,
  refreshUserCredentialsForXmpp,
} from '../helpers/resolveInitBeforeLoadUser';
import { pushLog as devPushLog } from '../utils/devLogger';
import type { IConfig } from '../types/types';

/**
 * Credentials the XMPP client reconnects with after a SASL
 * `not-authorized`. Order: session rotation (when enabled), the dedicated
 * xmpp-token endpoint, the full re-mint chain, then the stored value.
 * Never throws.
 */
export async function recoverXmppCredentials(
  config?: IConfig
): Promise<{ username: string; password: string }> {
  // 1. Make sure the REST tokens are fresh before re-minting XMPP
  //    creds. This used to call `config.refreshTokens.refreshFunction`
  //    directly and then fall into step 2, which refreshes again -
  //    two rotations back to back, which the new backend scheme
  //    reads as a race at best and token reuse at worst. One call to
  //    the shared rotation point covers both the consumer-supplied
  //    function and the built-in endpoint.
  if (config?.refreshTokens?.enabled) {
    const rotated = await refreshAuthTokensQuietly({ force: true });

    if (rotated?.xmppPassword) {
      const rotatedUser = store.getState().chatSettingStore.user;
      return {
        username:
          rotatedUser?.xmppUsername ||
          rotatedUser?.defaultWallet?.walletAddress ||
          '',
        password: rotated.xmppPassword,
      };
    }
  }

  // 2. Ask the endpoint built for exactly this: a fresh XMPP
  //    credential without touching the REST session. The store's own
  //    copy is the credential that just failed, so re-reading it is a
  //    no-op retry. Single-flight, never throws, writes the store.
  const minted = await fetchFreshXmppPassword();
  if (minted) {
    const u = store.getState().chatSettingStore.user;
    return {
      username: u?.xmppUsername || u?.defaultWallet?.walletAddress || '',
      password: minted,
    };
  }

  // 3. Re-mint XMPP creds via the right priority chain for the
  //    current auth mode. This call ALWAYS hydrates (unlike
  //    `resolveInitBeforeLoadUser` which short-circuits when a
  //    cached user already has xmppCredentials).
  const fresh = await refreshUserCredentialsForXmpp(config).catch(
    (err) => {
      devPushLog('warn', 'XMPP creds refresh: full chain failed', err);
      return null;
    }
  );
  if (fresh) {
    applyResolvedUserToStore(fresh);
    return {
      username:
        fresh.xmppUsername ||
        fresh.defaultWallet?.walletAddress ||
        '',
      password: fresh.xmppPassword || '',
    };
  }

  // 4. Last-resort: return the cached creds so reconnect() can
  //    still attempt a connection. If the original failure was
  //    a stale JWT this will fail again and the user has to
  //    re-mount the chat - but at least we don't break the
  //    transient-network-blip case where the cached creds are
  //    still valid.
  const u = store.getState().chatSettingStore.user;
  return {
    username: u?.xmppUsername || u?.defaultWallet?.walletAddress || '',
    password: u?.xmppPassword || '',
  };
}
