import { IConfig } from '../types/types';
import { store } from '../roomStore';
import { logout } from '../roomStore/chatSettingsSlice';
import { setLogoutState } from '../roomStore/roomsSlice';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { localStorageConstants } from './constants/LOCAL_STORAGE';
import { clearRoomsRestCache } from '../networking/api-requests/rooms.api';
import { clearPersistedState } from '../roomStore/persistence';
import {
  getGlobalXmppClient,
  setGlobalXmppClient,
} from '../utils/clientRegistry';

const SCOPE_KEY = '@ethora/chat-component-scope';

interface ScopeRecord {
  appId?: string;
  baseUrl?: string;
}

/**
 * Detect an app-scope change (different appId / baseUrl). When detected,
 * purge the persisted user, redux user/client/rooms state, REST caches,
 * and the global xmpp client singleton so the next bootstrap re-resolves
 * against the new tenant. Mirrors web ensureScopedChatCache.
 */
export async function ensureScopedChatCache(config?: IConfig): Promise<void> {
  if (!config?.appId && !config?.baseUrl) return;

  const next: ScopeRecord = {
    appId: config.appId,
    baseUrl: config.baseUrl,
  };

  const scopeStore = useLocalStorage<ScopeRecord>(SCOPE_KEY);
  const previous = await scopeStore.get();

  const changed =
    previous &&
    (previous.appId !== next.appId || previous.baseUrl !== next.baseUrl);

  if (changed) {
    try {
      const client = getGlobalXmppClient();
      if (client) {
        await client.disconnect?.({ suppressReconnect: true });
      }
    } catch {
      /* noop */
    }
    setGlobalXmppClient(null);

    clearRoomsRestCache();
    store.dispatch(setLogoutState());
    store.dispatch(logout());
    await useLocalStorage(localStorageConstants.ETHORA_USER).remove();
    await clearPersistedState();
  }

  await scopeStore.set(next);
}
