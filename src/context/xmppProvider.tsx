import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DeviceEventEmitter } from 'react-native';
import XmppClient from '../networking/xmppClient';
import {
  IConfig,
  ProviderBootstrapStatus,
  User,
  xmppSettingsInterface,
} from '../types/types';
import {
  buildXmppClientKey,
  getReusableXmppClientByKey,
  isXmppClientReusable,
  setGlobalXmppClient,
  withXmppClientInitLock,
} from '../utils/clientRegistry';
import {
  applyResolvedUserToStore,
  resolveInitBeforeLoadUser,
} from '../helpers/resolveInitBeforeLoadUser';
import { ensureScopedChatCache } from '../helpers/ensureScopedChatCache';
import { getRooms as prefetchRoomsViaRest } from '../networking/api-requests/rooms.api';
import { store } from '../roomStore';
import { logout, setStoreClient } from '../roomStore/chatSettingsSlice';
import { setLogoutState } from '../roomStore/roomsSlice';
import { runHistoryPreloadScheduler } from '../helpers/historyPreloadScheduler';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { localStorageConstants } from '../helpers/constants/LOCAL_STORAGE';
import { clearPersistedState } from '../roomStore/persistence';

interface InitMode {
  current: 'provider' | 'chat';
}

interface XmppContextType {
  client: XmppClient | null;
  providerBootstrapStatus: ProviderBootstrapStatus;
  initMode: InitMode['current'];
  setClient: (client: XmppClient | null) => void;
  initializeClient: (
    username: string,
    password: string,
    xmppSettings?: xmppSettingsInterface
  ) => Promise<XmppClient>;
}

const XmppContext = createContext<XmppContextType | null>(null);

interface XmppProviderProps {
  children: ReactNode;
  config?: IConfig;
}

const LOGOUT_EVENT = 'ethora-xmpp-logout';

export const XmppProvider: React.FC<XmppProviderProps> = ({ children, config }) => {
  const [client, setClient] = useState<XmppClient | null>(null);
  const [providerBootstrapStatus, setProviderBootstrapStatus] =
    useState<ProviderBootstrapStatus>('idle');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Track which "init mode" this provider runs in. When config.initBeforeLoad
  // is true, the provider owns bootstrap and ChatWrapper just waits.
  const initMode: InitMode['current'] = config?.initBeforeLoad ? 'provider' : 'chat';

  const lastCredsRef = useRef<{ username: string; password: string; settings?: xmppSettingsInterface } | null>(null);
  const completedBootstrapKeyRef = useRef<string>('');
  const inflightBootstrapKeyRef = useRef<string>('');

  const initializeClient = useCallback(
    async (
      username: string,
      password: string,
      xmppSettings?: xmppSettingsInterface
    ): Promise<XmppClient> => {
      const settings = xmppSettings || config?.xmppSettings;
      const key = buildXmppClientKey(username, settings);

      // 1. Reuse global singleton if it's the same key.
      const reusable = getReusableXmppClientByKey(key);
      if (reusable) {
        setClient(reusable);
        lastCredsRef.current = { username, password, settings };
        return reusable;
      }

      // 2. Reuse current provider client if still usable.
      if (client && isXmppClientReusable(client)) {
        lastCredsRef.current = { username, password, settings };
        return client;
      }

      // 3. Otherwise create a new client under the init lock to dedup
      //    concurrent calls for the same key.
      const created = await withXmppClientInitLock(key, async () => {
        const newClient = new XmppClient(username, password, settings);
        setGlobalXmppClient(newClient, key);
        await newClient.waitForOnline().catch((err) => {
          console.error('Error waiting for xmpp online:', err);
          throw err;
        });
        return newClient;
      });

      setClient(created);
      lastCredsRef.current = { username, password, settings };
      setReconnectAttempts(0);
      return created;
    },
    [client, config?.xmppSettings]
  );

  // -----------------------------------------------------------
  // initBeforeLoad — eager auth + xmpp connect at provider mount
  // -----------------------------------------------------------
  useEffect(() => {
    if (!config?.initBeforeLoad) {
      setProviderBootstrapStatus('idle');
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const run = async () => {
      // Stable bootstrap key — re-run only when these change.
      const explicitUser = config?.userLogin?.enabled ? config?.userLogin?.user : null;
      const key = [
        config?.appId || '',
        config?.baseUrl || '',
        explicitUser?.defaultWallet?.walletAddress || '',
        explicitUser?.xmppUsername || '',
        explicitUser?.token ? '1' : '0',
        config?.jwtLogin?.enabled ? config?.jwtLogin?.token || '' : '',
        config?.xmppSettings?.devServer || '',
      ].join('|');

      if (completedBootstrapKeyRef.current === key) return;
      if (inflightBootstrapKeyRef.current === key) return;
      inflightBootstrapKeyRef.current = key;
      setProviderBootstrapStatus('running');

      try {
        // clearStoreBeforeInit: wipe rooms + user before resolving, so
        // any stale persisted state from a prior tenant/account is gone.
        if (config?.clearStoreBeforeInit) {
          store.dispatch(setLogoutState());
          store.dispatch(logout());
          await useLocalStorage(localStorageConstants.ETHORA_USER).remove().catch(() => undefined);
        }

        await ensureScopedChatCache(config);

        const resolved: User | null = await resolveInitBeforeLoadUser({
          config,
          signal: abortController.signal,
        });
        if (cancelled) return;

        if (!resolved || !resolved.xmppPassword || !resolved.xmppUsername) {
          // No valid creds yet — back to idle so login path can take over.
          setProviderBootstrapStatus('failed');
          inflightBootstrapKeyRef.current = '';
          return;
        }

        applyResolvedUserToStore(resolved);

        // Fire REST prefetch in parallel — does NOT block xmpp connect.
        prefetchRoomsViaRest().catch(() => undefined);

        const c = await initializeClient(
          resolved.xmppUsername!,
          resolved.xmppPassword,
          config?.xmppSettings
        );
        if (cancelled) return;

        await c.waitForOnline();
        if (cancelled) return;

        // Cache room list + private store timestamps for ChatWrapper.
        try {
          await c.getRoomsStanza();
        } catch (e) {
          console.warn('initBeforeLoad: getRoomsStanza failed', e);
        }
        try {
          await c.getChatsPrivateStoreRequestStanza();
        } catch (e) {
          console.warn('initBeforeLoad: privateStore failed', e);
        }

        store.dispatch(setStoreClient(c));
        completedBootstrapKeyRef.current = key;
        inflightBootstrapKeyRef.current = '';
        setProviderBootstrapStatus('ready');

        // Background-prefetch history for every room (fire-and-forget).
        const qos = config?.historyQoS;
        const activeRoomJID = store.getState().rooms.activeRoomJID || null;
        const defaultRoomJids =
          (config?.defaultRooms as any[])?.map((r) =>
            typeof r === 'string' ? r : r?.jid
          ).filter(Boolean) || [];
        runHistoryPreloadScheduler({
          client: c,
          signal: abortController.signal,
          selectedRoomJid: activeRoomJID,
          defaultRoomJids,
          concurrency: qos?.stagedPreloadConcurrency,
          pageSize: qos?.stagedPreloadFirstPassSize,
          roomLimit: qos?.preloadTopKRooms,
        }).catch((err) => console.warn('History preload scheduler failed', err));
      } catch (error) {
        if (cancelled) return;
        console.error('initBeforeLoad bootstrap failed:', error);
        inflightBootstrapKeyRef.current = '';
        setProviderBootstrapStatus('failed');
      }
    };

    run();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    config?.initBeforeLoad,
    config?.appId,
    config?.baseUrl,
    config?.userLogin?.enabled,
    config?.userLogin?.user?.defaultWallet?.walletAddress,
    config?.userLogin?.user?.xmppUsername,
    config?.userLogin?.user?.token,
    config?.jwtLogin?.enabled,
    config?.jwtLogin?.token,
    config?.xmppSettings?.devServer,
    initializeClient,
  ]);

  // -----------------------------------------------------------
  // Reconnect / reinit on disconnect
  // -----------------------------------------------------------
  useEffect(() => {
    if (!client) return;
    if (client.status !== 'offline') return;

    if (reconnectAttempts < 3) {
      console.log(`xmpp reconnect attempt ${reconnectAttempts + 1}`);
      client.scheduleReconnect();
      setReconnectAttempts((prev) => prev + 1);
      return;
    }

    // After 3 failed reconnects, drop the client and re-init from scratch.
    if (lastCredsRef.current) {
      const { username, password, settings } = lastCredsRef.current;
      setGlobalXmppClient(null);
      setClient(null);
      initializeClient(username, password, settings).catch((err) =>
        console.error('Full reinit failed:', err)
      );
    }
  }, [client, client?.status, reconnectAttempts, initializeClient]);

  // -----------------------------------------------------------
  // Logout event listener (RN equivalent of window event)
  // -----------------------------------------------------------
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(LOGOUT_EVENT, async () => {
      try {
        if (client) {
          await client.disconnect({ suppressReconnect: true });
        }
      } catch (e) {
        console.warn('Logout disconnect failed', e);
      }
      setGlobalXmppClient(null);
      setClient(null);
      completedBootstrapKeyRef.current = '';
      inflightBootstrapKeyRef.current = '';
      setReconnectAttempts(0);
      setProviderBootstrapStatus('idle');
      await clearPersistedState();
    });
    return () => sub.remove();
  }, [client]);

  return (
    <XmppContext.Provider
      value={{
        client,
        providerBootstrapStatus,
        initMode,
        initializeClient,
        setClient,
      }}
    >
      {children}
    </XmppContext.Provider>
  );
};

export const useXmppClient = () => {
  const context = useContext(XmppContext);
  if (!context) {
    throw new Error('useXmppClient must be used within an XmppProvider');
  }
  return context;
};

/** Trigger a global xmpp logout — mirrors the web `ethora-xmpp-logout` event. */
export function emitXmppLogout() {
  DeviceEventEmitter.emit(LOGOUT_EVENT);
}
