import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import XmppClient, {
  XmppCredentialsProvider,
} from '../networking/xmppClient';
import { refreshTokens } from '../roomStore/chatSettingsSlice';
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
  refreshUserCredentialsForXmpp,
  resolveInitBeforeLoadUser,
} from '../helpers/resolveInitBeforeLoadUser';
import { ensureScopedChatCache } from '../helpers/ensureScopedChatCache';
import { getRooms as prefetchRoomsViaRest } from '../networking/api-requests/rooms.api';
import { allRoomPresences } from '../networking/xmpp/allRoomPresences.xmpp';
import { store } from '../roomStore';
import { logout, setStoreClient } from '../roomStore/chatSettingsSlice';
import { setLogoutState } from '../roomStore/roomsSlice';
import { runHistoryPreloadScheduler } from '../helpers/historyPreloadScheduler';
import { asyncLocalStorage } from '../hooks/useLocalStorage';
import { localStorageConstants } from '../helpers/constants/LOCAL_STORAGE';
import { clearPersistedState } from '../roomStore/persistence';
import { pushLog as devPushLog } from '../utils/devLogger';

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

  // Callback XmppClient uses to fetch fresh credentials after a SASL
  // `not-authorized` (typically JWT expiry during idle, bug #17).
  // Always installed — the underlying `refreshUserCredentialsForXmpp`
  // picks the right path based on config:
  //   - `jwtLogin` → re-exchange JWT via `/users/client`
  //   - `userLogin` / `customLogin` / store / persisted → `/users/my`
  //     with REST refresh chain (handles 401 → refresh → retry)
  // Returns last-known cached creds if nothing usable is available so
  // the XmppClient at least doesn't crash on `undefined.password`.
  const credentialsProvider = useMemo<XmppCredentialsProvider>(() => {
    return async () => {
      // 1. Consumer-supplied REST refresh (when wired). This runs
      //    before the SDK's own refresh chain so non-Ethora backends
      //    can keep auth state in sync with their own token endpoint.
      const customRefresh = config?.refreshTokens?.refreshFunction;
      if (customRefresh) {
        try {
          const result = await customRefresh();
          if (result?.accessToken) {
            store.dispatch(
              refreshTokens({
                token: result.accessToken,
                refreshToken: result.refreshToken || '',
              })
            );
          }
        } catch (err) {
          devPushLog('warn', 'XMPP creds refresh: customRefresh failed', err);
        }
      }

      // 2. Re-mint XMPP creds via the right priority chain for the
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

      // 3. Last-resort: return the cached creds so reconnect() can
      //    still attempt a connection. If the original failure was
      //    a stale JWT this will fail again and the user has to
      //    re-mount the chat — but at least we don't break the
      //    transient-network-blip case where the cached creds are
      //    still valid.
      const u = store.getState().chatSettingStore.user;
      return {
        username: u?.xmppUsername || u?.defaultWallet?.walletAddress || '',
        password: u?.xmppPassword || '',
      };
    };
  }, [
    config?.jwtLogin?.enabled,
    config?.jwtLogin?.token,
    config?.refreshTokens?.refreshFunction,
    config?.userLogin?.enabled,
    config?.customLogin?.enabled,
    config?.initBeforeLoadAuth?.myEndpoint,
  ]);

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
        // Wire up the credentialsProvider so SASL `not-authorized`
        // after idle triggers a refresh chain (jwtLogin →
        // /users/client; userLogin/customLogin/store → /users/my +
        // REST refresh) instead of looping forever with stale creds.
        // Bug #17 — full coverage in 26.5.6.
        newClient.setCredentialsProvider(credentialsProvider);
        setGlobalXmppClient(newClient, key);
        await newClient.waitForOnline().catch((err) => {
          console.error('Error waiting for xmpp online:', err);
          throw err;
        });
        return newClient;
      });

      // Reused clients (steps 1+2 above) also need the provider — config
      // may have changed since the singleton was created.
      created.setCredentialsProvider(credentialsProvider);

      setClient(created);
      lastCredsRef.current = { username, password, settings };
      setReconnectAttempts(0);
      return created;
    },
    [client, config?.xmppSettings, credentialsProvider]
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

      if (completedBootstrapKeyRef.current === key) {
        devPushLog('rn', 'initBeforeLoad: already completed (same key) — skip');
        return;
      }
      if (inflightBootstrapKeyRef.current === key) {
        devPushLog('rn', 'initBeforeLoad: in-flight (same key) — skip');
        return;
      }
      inflightBootstrapKeyRef.current = key;
      setProviderBootstrapStatus('running');
      devPushLog('rn', 'initBeforeLoad: running', {
        appId: config?.appId,
        baseUrl: config?.baseUrl,
        mode:
          config?.jwtLogin?.enabled ? 'jwt' :
          config?.userLogin?.enabled ? 'userLogin' :
          config?.customLogin?.enabled ? 'customLogin' : 'fallback',
      });

      try {
        if (config?.clearStoreBeforeInit) {
          devPushLog('rn', 'initBeforeLoad: clearStoreBeforeInit');
          store.dispatch(setLogoutState());
          store.dispatch(logout());
          await asyncLocalStorage(localStorageConstants.ETHORA_USER).remove().catch(() => undefined);
        }

        await ensureScopedChatCache(config);
        devPushLog('rn', 'initBeforeLoad: scope ok, resolving user…');

        const resolved: User | null = await resolveInitBeforeLoadUser({
          config,
          signal: abortController.signal,
        });
        if (cancelled) {return;}

        if (!resolved || !resolved.xmppPassword || !resolved.xmppUsername) {
          devPushLog('error', 'initBeforeLoad: user resolve failed', {
            hasResolved: !!resolved,
            xmppUsername: resolved?.xmppUsername,
            xmppPasswordPresent: !!resolved?.xmppPassword,
          });
          setProviderBootstrapStatus('failed');
          inflightBootstrapKeyRef.current = '';
          return;
        }

        devPushLog('rn', `initBeforeLoad: user resolved (${resolved.xmppUsername})`);
        applyResolvedUserToStore(resolved);

        // Kick off REST /chats/my; allRoomPresences below needs the
        // room list to be in redux, otherwise it joins 0 MUCs and the
        // user receives zero realtime messages until they manually tap
        // into each room. Track the promise so we can await it before
        // joining presences.
        const restRoomsPromise = prefetchRoomsViaRest().catch(() => undefined);

        const c = await initializeClient(
          resolved.xmppUsername!,
          resolved.xmppPassword,
          config?.xmppSettings
        );
        if (cancelled) {return;}
        devPushLog('rn', 'initBeforeLoad: xmpp client created, waiting online…');

        await c.waitForOnline();
        if (cancelled) {return;}
        devPushLog('xmpp', 'initBeforeLoad: xmpp online');

        try {
          await c.getRoomsStanza();
          devPushLog('xmpp', 'initBeforeLoad: getRoomsStanza ok');
        } catch (e) {
          devPushLog('warn', 'initBeforeLoad: getRoomsStanza failed', e);
        }
        try {
          await c.getChatsPrivateStoreRequestStanza();
          devPushLog('xmpp', 'initBeforeLoad: privateStore ok');
        } catch (e) {
          devPushLog('warn', 'initBeforeLoad: privateStore failed', e);
        }
        // Wait for REST /chats/my to populate the room list before
        // joining MUC presences. Race-skipping this step left the user
        // subscribed to 0 rooms and no realtime delivery.
        try {
          await restRoomsPromise;
        } catch {}
        try {
          const roomCount = Object.keys(store.getState().rooms.rooms || {}).length;
          devPushLog('xmpp', `initBeforeLoad: joining ${roomCount} rooms via presence…`);
          await allRoomPresences((c as any).client);
          devPushLog('xmpp', 'initBeforeLoad: allRoomPresences ok');
        } catch (e) {
          devPushLog('warn', 'initBeforeLoad: allRoomPresences failed', e);
        }

        store.dispatch(setStoreClient(c));
        completedBootstrapKeyRef.current = key;
        inflightBootstrapKeyRef.current = '';
        setProviderBootstrapStatus('ready');
        devPushLog('rn', 'initBeforeLoad: READY');

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
      } catch (error: any) {
        if (cancelled) {return;}
        devPushLog('error', 'initBeforeLoad: bootstrap threw', {
          message: error?.message,
          status: error?.response?.status,
          data: error?.response?.data,
        });
        inflightBootstrapKeyRef.current = '';
        setProviderBootstrapStatus('failed');
      }
    };

    run();

    return () => {
      cancelled = true;
      abortController.abort();
      // Re-running this effect (deps changed or unmount) must release the
      // in-flight bootstrap key so the next render isn't permanently
      // short-circuited by the early `inflightBootstrapKeyRef === key`
      // check. Without this, a `setClient` mid-bootstrap that re-renders
      // the provider strands the bootstrap in `running`.
      inflightBootstrapKeyRef.current = '';
    };
    // NOTE: `initializeClient` is intentionally NOT in the dep array.
    // It's a `useCallback` that depends on `client` state; including it
    // would force the effect to re-run every time `setClient` fires
    // (which happens DURING bootstrap), causing a cancel/re-init storm.
    // The function is still reachable through closure; its identity drift
    // is irrelevant to bootstrap semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  ]);

  // -----------------------------------------------------------
  // Reconnect / reinit on disconnect
  // -----------------------------------------------------------
  useEffect(() => {
    if (!client) {return;}
    // Successful (re)connect — clear the backoff counter so the next
    // blip starts a fresh 3-attempt budget instead of jumping straight
    // to a full re-init.
    if (client.status === 'online') {
      if (reconnectAttempts !== 0) {setReconnectAttempts(0);}
      return;
    }
    if (client.status !== 'offline') {return;}

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
  // AppState → background: flush lastViewedTimestamp into the
  // server's private store so the next session shows the correct
  // unread state. Without this, leaving the app open in chat and
  // killing it (or just switching apps) never persists "I read up to
  // here" — the next launch reads the stale marker and over-counts
  // unread.
  //
  // Cheap to run on every transition out of `active`: a no-op when
  // there is no client, when nothing has moved past the existing
  // entry, or when this build has `disableLastRead`.
  // -----------------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const c = client;
      if (next === 'active') {
        // Returned to foreground. If the socket died while backgrounded
        // (iOS suspends the WebSocket; long background kills it), the
        // status may still read 'online' until xmpp.js notices the dead
        // TCP — which can take a full timeout. Force an immediate
        // reconnect when we're not provably online so cached UI gets
        // live again fast instead of "100 years".
        // Only force a reconnect from a genuinely dead state. Don't
        // interrupt an in-progress 'connecting' (iOS delivers spurious
        // inactive→active flaps for control-center / notifications /
        // biometric prompts that would otherwise restart a healthy
        // connect).
        if (c && (c.status === 'offline' || c.status === 'error')) {
          devPushLog('rn', `AppState active: client ${c.status} → forceReconnect`);
          setReconnectAttempts(0);
          c.forceReconnect();
        }
        return;
      }
      // Going to background/inactive (sleep / app switcher / tray):
      // flush lastViewedTimestamp into the server private store so the
      // next session shows the correct unread state.
      if (!c) {return;}
      const state = store.getState();
      const rooms = state.rooms?.rooms;
      const activeRoomJID = state.rooms?.activeRoomJID || null;
      // Fire-and-forget — we're going to the background and don't
      // care about the resolution path.
      c.flushLastViewedToPrivateStoreStanza(rooms, { activeRoomJID }).catch(
        () => {}
      );
    });
    return () => sub.remove();
  }, [client]);

  // -----------------------------------------------------------
  // NetInfo → proactive reconnect on network restore. Without this the
  // only reconnect trigger is xmpp.js noticing the socket is dead, which
  // on a Wi-Fi/cellular drop can hang on the TCP timeout for tens of
  // seconds. NetInfo tells us the instant connectivity returns so we can
  // force a reconnect immediately (and reset the backoff budget).
  // -----------------------------------------------------------
  useEffect(() => {
    if (!client) {return;}
    let wasOffline = false;
    const unsub = NetInfo.addEventListener((state) => {
      // Guard against undefined/partial state (jest mock, early emit).
      const reachable =
        !!state?.isConnected && state?.isInternetReachable !== false;
      if (!reachable) {
        wasOffline = true;
        return;
      }
      // Network just came back (was offline → now reachable).
      if (wasOffline) {
        wasOffline = false;
        if (client.status === 'offline' || client.status === 'error') {
          devPushLog('rn', 'NetInfo: network restored → forceReconnect');
          setReconnectAttempts(0);
          client.forceReconnect();
        }
      }
    });
    return () => unsub();
  }, [client]);

  // -----------------------------------------------------------
  // Retry-bootstrap listener — fired by ChatWrapper's error modal so
  // a transient failure (bad endpoint, server hiccup, etc.) can be
  // recovered without forcing the user to unmount the whole chat.
  // -----------------------------------------------------------
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('ethora:retryBootstrap', () => {
      completedBootstrapKeyRef.current = '';
      inflightBootstrapKeyRef.current = '';
      setProviderBootstrapStatus('idle');
    });
    return () => sub.remove();
  }, []);

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
