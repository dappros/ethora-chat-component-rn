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
import { VideoCallOverlay } from '../components/VideoCalls/VideoCallOverlay';
import XmppClient, {
  XmppCredentialsProvider,
} from '../networking/xmppClient';
import { refreshAuthTokensQuietly } from '../networking/authRefresh';
import {
  IConfig,
  ProviderBootstrapStatus,
  User,
  xmppSettingsInterface,
} from '../types/types';
import {
  buildXmppClientKey,
  getGlobalXmppClient,
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
import { logout, setStoreClient, setConfig } from '../roomStore/chatSettingsSlice';
import {
  setLogoutState,
  setVisibleRoom,
  clearVisibleRoom,
  setLastViewedTimestamp,
  deleteRoomMessage,
  msgSortableMs,
  setUnreadSyncing,
} from '../roomStore/roomsSlice';
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
  // Consumer-supplied "is the chat surface shown" signal for hosts that
  // keep <Chat> mounted while hidden (tab/route navigators). See the
  // visibility effect below. Omit when you unmount <Chat> on hide.
  isVisible?: boolean;
}

const LOGOUT_EVENT = 'ethora-xmpp-logout';

export const XmppProvider: React.FC<XmppProviderProps> = ({ children, config, isVisible }) => {
  const [client, setClient] = useState<XmppClient | null>(null);
  const [providerBootstrapStatus, setProviderBootstrapStatus] =
    useState<ProviderBootstrapStatus>('idle');

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
      // 1. Make sure the REST tokens are fresh before re-minting XMPP
      //    creds. This used to call `config.refreshTokens.refreshFunction`
      //    directly and then fall into step 2, which refreshes again —
      //    two rotations back to back, which the new backend scheme
      //    reads as a race at best and token reuse at worst. One call to
      //    the shared rotation point covers both the consumer-supplied
      //    function and the built-in endpoint.
      if (config?.refreshTokens?.enabled) {
        const rotated = await refreshAuthTokensQuietly();

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
    config?.refreshTokens?.enabled,
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
        const prevGlobal = getGlobalXmppClient();
        if (prevGlobal) {
          try { await prevGlobal.close(); } catch {}
        }
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

      // Re-join MUC rooms on every 'online'. After a reconnect the new
      // XMPP stream isn't a member of any room, so a sent message gets a
      // local double-tick but never reaches the room (bug #21). Re-sending
      // presence on reconnect fixes delivery. On the very first connect
      // the room list isn't loaded yet so this joins nothing — the
      // bootstrap's own allRoomPresences handles that pass.
      created.setOnOnline(() => {
        const underlying = (created as any).client;
        if (!underlying) {return;}
        allRoomPresences(underlying).catch((e) =>
          devPushLog('warn', 'reconnect: allRoomPresences re-join failed', e)
        );
        // Also refresh the private store so unread / lastViewed markers
        // are accurate after a long reconnect — the MUC re-join above only
        // restores delivery, not unread state. Idempotent on first connect.
        created
          .getChatsPrivateStoreRequestStanza()
          .catch((e: unknown) =>
            devPushLog('warn', 'reconnect: privateStore refresh failed', e)
          );
      });

      setClient(created);
      lastCredsRef.current = { username, password, settings };
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
    // Auto-retry a TRANSIENT bootstrap failure a few times with backoff
    // before surfacing the error modal — a flaky network at launch should
    // self-heal, not dead-end the user on a Retry button. (Bad-creds
    // failures resolve to null below and fail fast — they never reach the
    // catch, so they aren't retried.)
    const MAX_BOOTSTRAP_ATTEMPTS = 3;
    let bootstrapAttempt = 0;
    // Overall time budget: if we never reach 'ready' (a step hangs), abort
    // the in-flight work and fail so the loader can't spin forever.
    const BOOTSTRAP_BUDGET_MS = 45000;
    let reachedReady = false;
    let budgetTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (cancelled || reachedReady) {return;}
      devPushLog('warn', 'initBeforeLoad: time budget exceeded → failed');
      abortController.abort();
      inflightBootstrapKeyRef.current = '';
      store.dispatch(setUnreadSyncing(false));
      setProviderBootstrapStatus('failed');
    }, BOOTSTRAP_BUDGET_MS);
    const clearBudget = () => {
      if (budgetTimer) {
        clearTimeout(budgetTimer);
        budgetTimer = null;
      }
    };

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
      store.dispatch(setUnreadSyncing(true));
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
          store.dispatch(setUnreadSyncing(false));
          return;
        }

        devPushLog('rn', `initBeforeLoad: user resolved (${resolved.xmppUsername})`);
        applyResolvedUserToStore(resolved);

        if (config) {
          store.dispatch(setConfig(config));
        }

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
        reachedReady = true;
        clearBudget();
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
        if (cancelled || abortController.signal.aborted) {return;}
        bootstrapAttempt += 1;
        // Throws here are transient (network / XMPP connect). A bad-creds
        // failure resolves to null above and fails fast without throwing,
        // so it never reaches this catch. Retry with backoff before the
        // modal; release the in-flight key so the recursive run() isn't
        // short-circuited by its own guard.
        if (bootstrapAttempt < MAX_BOOTSTRAP_ATTEMPTS) {
          const backoff = Math.min(8000, 1000 * 2 ** (bootstrapAttempt - 1));
          devPushLog(
            'rn',
            `initBeforeLoad: attempt ${bootstrapAttempt} failed (${error?.message}); retrying in ${backoff}ms`
          );
          inflightBootstrapKeyRef.current = '';
          setTimeout(() => {
            if (!cancelled && !abortController.signal.aborted) {
              run();
            }
          }, backoff);
          return;
        }
        devPushLog('error', 'initBeforeLoad: bootstrap threw (giving up)', {
          message: error?.message,
          status: error?.response?.status,
          data: error?.response?.data,
        });
        inflightBootstrapKeyRef.current = '';
        clearBudget();
        store.dispatch(setUnreadSyncing(false));
        setProviderBootstrapStatus('failed');
      }
    };

    run();

    return () => {
      cancelled = true;
      clearBudget();
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
  // Reconnect watchdog. The client now owns reconnection (onDisconnect →
  // scheduleReconnect with uncapped, clamped backoff; a connect 'error'
  // reschedules too). This is the single provider-side safety net for the
  // states the event-driven triggers miss: a stuck 'connecting', a connect
  // 'error', or a server-side outage where NetInfo never reported the
  // device offline. While foregrounded, if we're not provably online and
  // not suppressed, force a reconnect (debounced inside forceReconnect).
  //
  // Replaces the old status-keyed reconnect effect, which keyed on
  // `client.status` — a mutated class field React does NOT track — so on a
  // silent socket drop it frequently never re-ran (and its 3-attempts-then-
  // full-reinit path was effectively dead).
  // -----------------------------------------------------------
  useEffect(() => {
    if (!client) {return;}
    const id = setInterval(() => {
      // Only skip while genuinely backgrounded. iOS also reports 'inactive'
      // for transient states the user still sees the chat through (control
      // centre, an incoming-call banner, app-switcher preview, and — on the
      // simulator — whenever the window is not focused). Gating on
      // `!== 'active'` meant the watchdog silently stopped running in all of
      // those, so a socket that dropped during one never got revived.
      if (AppState.currentState === 'background') {return;}
      if (client.suppressReconnect) {return;}
      if (client.status !== 'online') {
        devPushLog('rn', `watchdog: client ${client.status} → forceReconnect`);
        client.forceReconnect();
      } else {
        client.ensureStreamAlive?.();
      }
    }, 30000);
    return () => clearInterval(id);
  }, [client]);

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
    // Remembers the room that was visible when we backgrounded so it can
    // be re-marked visible on return. Lives in the effect closure (one per
    // client) — persists across the listener's many invocations.
    let visibleBeforeBackground: string | null = null;
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
          c.forceReconnect();
        }
        // Re-mark the previously-open room visible so its unread clears
        // now that the user is looking again. We restore ONLY what was
        // visible at background time, so a chat the consumer had already
        // blurred (e.g. on a non-chat tab/route) correctly stays cleared.
        if (visibleBeforeBackground) {
          store.dispatch(setVisibleRoom({ roomJID: visibleBeforeBackground }));
          visibleBeforeBackground = null;
        }
        return;
      }
      // Going to background/inactive (sleep / app switcher / tray):
      if (!c) {return;}
      const state = store.getState();
      const rooms = state.rooms?.rooms;
      const visibleRoomJID = state.rooms?.visibleRoomJID || null;
      // Mark the open room "not visible" while backgrounded so messages
      // that arrive (or MAM-replay on reconnect) count as unread instead
      // of being silently treated as read — the "mounted == visible ==
      // read" gap. Stamp lastViewed=now as the read baseline, clear
      // visibility, then flush that marker to the server private store.
      // Restored on the next 'active' transition above. Handled here in
      // the provider so consumers using the component as a package get
      // correct unread without reaching into the chat store themselves.
      visibleBeforeBackground = visibleRoomJID;
      if (visibleRoomJID) {
        store.dispatch(
          setLastViewedTimestamp({ chatJID: visibleRoomJID, timestamp: Date.now() })
        );
        // Drop the "New messages" divider for the room we're leaving so it
        // doesn't linger when the user comes back (mirrors ChatRoom's
        // unmount cleanup, which never runs while the pane stays mounted).
        store.dispatch(
          deleteRoomMessage({ roomJID: visibleRoomJID, messageId: 'delimiter-new' })
        );
        store.dispatch(clearVisibleRoom());
      }
      // Fire-and-forget — we're going to the background and don't
      // care about the resolution path.
      c.flushLastViewedToPrivateStoreStanza(rooms, { visibleRoomJID }).catch(
        () => {}
      );
    });
    return () => sub.remove();
  }, [client]);

  // -----------------------------------------------------------
  // Consumer visibility signal (`isVisible` prop). For hosts that keep
  // <Chat> MOUNTED while hidden (tab/route navigators — so the XMPP
  // connection survives tab switches), ChatRoom's mount/unmount can't tell
  // "shown" from "hidden", so the unread middleware would keep the open
  // room's badge at 0 and messages arriving while you're elsewhere look
  // already-read. When the host passes `isVisible`, mirror the AppState
  // background/foreground handling: hidden → stamp lastViewed=now + clear
  // room visibility (so later messages count) + flush; shown → restore
  // visibility for the open room. Doing it here means consumers never
  // touch the chat store themselves. (Undefined = host unmounts on hide,
  // nothing to do.)
  // -----------------------------------------------------------
  const chatWasVisibleRef = useRef(false);
  useEffect(() => {
    if (typeof isVisible !== 'boolean') {return;}
    const state = store.getState();
    const rooms = state.rooms?.rooms;
    const activeRoomJID = state.rooms?.activeRoomJID || null;
    const wasVisible = chatWasVisibleRef.current;
    chatWasVisibleRef.current = isVisible;
    if (isVisible) {
      if (activeRoomJID) {
        store.dispatch(setVisibleRoom({ roomJID: activeRoomJID }));
      }
    } else {
      if (wasVisible && activeRoomJID) {
        store.dispatch(
          setLastViewedTimestamp({ chatJID: activeRoomJID, timestamp: Date.now() })
        );
        // Drop the "New messages" divider so it's gone when the user
        // returns to the chat (mirrors ChatRoom's unmount cleanup).
        store.dispatch(
          deleteRoomMessage({ roomJID: activeRoomJID, messageId: 'delimiter-new' })
        );
      }

      store.dispatch(clearVisibleRoom());
      if (wasVisible && client?.flushLastViewedToPrivateStoreStanza) {
        client
          .flushLastViewedToPrivateStoreStanza(rooms, { visibleRoomJID: activeRoomJID })
          .catch(() => {});
      }
    }
  }, [isVisible, client]);

  useEffect(() => {
    if (isVisible !== true) {return;}
    let lastMessagesRef: any = null;
    let lastStampedMs = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const advance = () => {
      const s = store.getState();
      const jid = s.rooms?.activeRoomJID;
      if (!jid) {return;}
      const room = s.rooms?.rooms?.[jid];
      if (!room) {return;}
      if (room.messages === lastMessagesRef) {return;}
      lastMessagesRef = room.messages;

      let newest = 0;
      const list = room.messages || [];
      for (const m of list) {
        if (!m || m.id === 'delimiter-new') {continue;}
        const ms = msgSortableMs(m);
        if (ms > newest) {newest = ms;}
      }
      if (newest <= lastStampedMs) {return;}
      lastStampedMs = newest;

      store.dispatch(
        setLastViewedTimestamp({ chatJID: jid, timestamp: Date.now() })
      );

      if (flushTimer) {clearTimeout(flushTimer);}
      if (client?.flushLastViewedToPrivateStoreStanza) {
        flushTimer = setTimeout(() => {
          client
            .flushLastViewedToPrivateStoreStanza(store.getState().rooms?.rooms, {
              visibleRoomJID: jid,
            })
            .catch(() => {});
        }, 2000);
      }
    };

    advance();
    const unsub = store.subscribe(advance);
    return () => {
      unsub();
      if (flushTimer) {clearTimeout(flushTimer);}
    };
  }, [isVisible, client]);

  // -----------------------------------------------------------
  // NetInfo → proactive reconnect on network restore. Without this the
  // only reconnect trigger is xmpp.js noticing the socket is dead, which
  // on a Wi-Fi/cellular drop can hang on the TCP timeout for tens of
  // seconds. NetInfo tells us the instant connectivity returns so we can
  // force a reconnect immediately (and reset the backoff budget).
  // -----------------------------------------------------------
  useEffect(() => {
    if (!client) {return;}
    const unsub = NetInfo.addEventListener((state) => {
      // Guard against undefined/partial state (jest mock, early emit).
      const reachable =
        !!state?.isConnected && state?.isInternetReachable !== false;
      if (!reachable) {return;}
      // Reachable. If we're in a dead state, kick a reconnect — do NOT
      // require a prior offline→online transition (a missed/coalesced
      // offline event otherwise left us stuck offline forever). Skip
      // 'connecting' so we don't interrupt an in-progress connect; the
      // watchdog covers a stuck 'connecting'. forceReconnect() debounces
      // bursts and resets the backoff itself.
      if (client.status === 'offline' || client.status === 'error') {
        devPushLog('rn', `NetInfo: reachable & client ${client.status} → forceReconnect`);
        client.forceReconnect();
      } else if (client.status === 'online') {
        client.ensureStreamAlive?.();
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
      {/* Lives here, not inside <Chat>: an incoming call-token can arrive
          (and must still ring) while the user is on a different screen of
          the host app, as long as the socket is up. VideoCallOverlay reads
          config and call state from Redux itself, so it needs nothing
          passed in, and renders null whenever no call is in flight. */}
      <VideoCallOverlay />
    </XmppContext.Provider>
  );
};

export const useXmppClient = () => {
  const context = useContext(XmppContext);
  if (!context) {
    throw new Error('useXmppClient must be used within an XmppProvider');
  }
  if (!context.client) {
    const candidates: Array<XmppClient | null | undefined> = [
      getGlobalXmppClient(),
      store.getState()?.chatSettingStore?.client as XmppClient | undefined,
    ];
    const live = candidates.find(
      (c) => c && (c as any).status === 'online'
    );
    if (live) {
      return { ...context, client: live };
    }
  }
  return context;
};

/** Trigger a global xmpp logout — mirrors the web `ethora-xmpp-logout` event. */
export function emitXmppLogout() {
  DeviceEventEmitter.emit(LOGOUT_EVENT);
}
