import xmpp, { Client } from '@xmpp/client';
import { walletToUsername } from '../helpers/walletUsername';
import { xmppSettingsInterface } from '../types/types';

import { sendMediaMessage } from './xmpp/sendMediaMessage.xmpp';
import { getChatsPrivateStoreRequest } from './xmpp/getChatsPrivateStoreRequest.xmpp';
import { actionSetTimestampToPrivateStore } from './xmpp/actionSetTimestampToPrivateStore.xmpp';
import { flushLastViewedToPrivateStore } from './xmpp/flushLastViewedToPrivateStore';
import { sendTypingRequest } from './xmpp/sendTypingRequest.xmpp';
import { sendPing } from './xmpp/sendPing.xmpp';
import { getHistory } from './xmpp/getHistory.xmpp';
import { sendTextMessage } from './xmpp/sendTextMessage.xmpp';
import { deleteMessage } from './xmpp/deleteMessage.xmpp';
import { presenceInRoom } from './xmpp/presenceInRoom.xmpp';
import { getLastMessage } from './xmpp/getLastMessageArchive.xmpp';
import { createRoom } from './xmpp/createRoom.xmpp';
import { setRoomImage } from './xmpp/setRoomImage.xmpp';
import { getRoomMembers } from './xmpp/getRoomMembers.xmpp';
import { getRoomInfo } from './xmpp/getRoomInfo.xmpp';
import { leaveTheRoom } from './xmpp/leaveTheRoom.xmpp';
import { editMessage } from './xmpp/editMessage.xmpp';
import { inviteRoomRequest } from './xmpp/inviteRoomRequest.xmpp';
import { getRooms } from './xmpp/getRooms.xmpp';
import { handleStanza } from './xmpp/handleStanzas.xmpp';
import { pushLog as devPushLog } from '../utils/devLogger';
import { normalizeRoomJid } from '../helpers/normalizeRoomJid';
import { store } from '../roomStore';
import { applyPrivateStoreMarkers } from '../roomStore/roomsSlice';
import {
  clearOutboundSends,
  enqueueOutboundSend,
  flushOutboundSends,
} from './outboundQueue';

// Canonical production XMPP WSS endpoint (standard wss/443, no port suffix).
const DEFAULT_DEV_SERVER = 'xmpp.chat.ethora.com';

// @xmpp/client surfaces SASL/stream errors in a few shapes depending on
// where it fails — XMPPError on stream:error, SASLError on SASL bind, or
// a generic Error whose message contains "not-authorized". Match all of
// them so we trigger the credentials refresh path consistently.
function isNotAuthorizedError(err: any): boolean {
  if (!err) {return false;}
  const condition =
    err?.condition ||
    err?.name ||
    err?.type ||
    err?.error?.condition ||
    '';
  if (typeof condition === 'string' && condition.includes('not-authorized')) {
    return true;
  }
  const message = (err?.message || err?.text || '').toString();
  return /not-authorized|SASLError/i.test(message);
}

type HistorySource = 'active' | 'send_ack' | 'background' | 'default';

interface HistoryOptions {
  coalesceRoom?: boolean;
  skipIfPreloaded?: boolean;
  source?: HistorySource;
}

interface MamInFlightEntry {
  promise: Promise<any>;
  source: HistorySource;
  startedAt: number;
}

export type XmppCredentialsProvider = () => Promise<{
  username: string;
  password: string;
}>;

export class XmppClient {
  client!: Client;
  xmppSettings?: xmppSettingsInterface;
  devServer: string | undefined;
  host: string = '';
  service: string = '';
  conference: string = '';
  username: string;
  status: 'offline' | 'connecting' | 'online' | 'error' = 'offline';

  password = '';
  reconnectAttempts = 0;
  maxReconnectAttempts = 5;
  reconnectDelay = 2000;
  // Upper bound on the backoff delay. The old hard stop at
  // maxReconnectAttempts gave up entirely after ~62s; now we keep retrying
  // at a steady cadence on a long outage and just clamp the delay here.
  maxReconnectDelay = 30000;
  // Timestamp of the last forced reconnect so bursty external triggers
  // (NetInfo + AppState + the provider watchdog firing together) can't
  // spawn a reconnect storm.
  private lastReconnectAt = 0;
  suppressReconnect = false;
  // Tracked so close()/disconnect() can cancel a pending reconnect —
  // otherwise a scheduleReconnect() timer fires after logout and (until
  // suppressReconnect short-circuits it) keeps the dead instance alive.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Single-flight guard for reconnect(). Multiple triggers can fire near-
  // simultaneously (AppState 'active' + NetInfo restore + a scheduled
  // timer). Without this, two overlapping reconnect()s each spawn a fresh
  // underlying client and one is leaked with its `stanza` handler still
  // bound → duplicate stanza dispatch into redux.
  private reconnecting = false;

  // Set when SASL fails with `not-authorized` (typically a stale JWT-
  // derived XMPP password after idle). Triggers the credentialsProvider
  // refresh path in reconnect().
  lastAuthError: 'not-authorized' | null = null;
  private credentialsProvider: XmppCredentialsProvider | null = null;
  private credentialsRefreshInFlight: Promise<void> | null = null;
  // Fired by the provider on every 'online' so it can re-join MUC rooms
  // after a reconnect (bug #21 — reconnected but not in the room).
  private onOnlineCallback: (() => void) | null = null;

  // ---- QoS state (mirrors web XmppClient) ----------------------------
  presencesReady = false;
  disableLastRead = false;
  private activeRoomJID: string | null = null;
  private activeRoomBoostUntil = 0;
  private softPauseUntil = 0;
  private mamInFlightByRoom: Map<string, MamInFlightEntry> = new Map();
  private maxInFlightHistory = 3;
  private softPauseAfterSendMs = 250;
  private activeRoomBoostTtlMs = 4000;
  private alwaysPrioritizeActiveRoom = true;

  // -------------------------------------------------------------------

  checkOnline() {
    return this.client && this.client.status === 'online';
  }

  /**
   * Inject (or replace) the callback used by reconnect() to fetch fresh
   * XMPP credentials after a `not-authorized` SASL failure. The provider
   * is responsible for refreshing whatever upstream token is needed
   * (REST JWT, /users/client, etc.) and returning the resulting
   * username + password.
   */
  setCredentialsProvider(provider: XmppCredentialsProvider | null) {
    this.credentialsProvider = provider;
  }

  /** Install a callback invoked on every successful 'online'. The provider
   * uses it to re-join MUC rooms after a reconnect. */
  setOnOnline(cb: (() => void) | null) {
    this.onOnlineCallback = cb;
  }

  /** Swap in fresh credentials before the next reconnect. */
  updateCredentials(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  constructor(
    username: string,
    password: string,
    xmppSettings?: xmppSettingsInterface | string
  ) {
    // Back-compat: third arg used to be a bare devServer string.
    if (typeof xmppSettings === 'string') {
      this.xmppSettings = { devServer: xmppSettings };
      this.devServer = xmppSettings;
    } else {
      this.xmppSettings = xmppSettings;
      this.devServer = xmppSettings?.devServer;
    }
    this.disableLastRead = this.xmppSettings?.disableLastRead === true;

    const qos = this.xmppSettings?.historyQoS;
    if (qos) {
      if (typeof qos.maxInFlightHistory === 'number')
        {this.maxInFlightHistory = qos.maxInFlightHistory;}
      if (typeof qos.softPauseAfterSendMs === 'number')
        {this.softPauseAfterSendMs = qos.softPauseAfterSendMs;}
      if (typeof qos.activeRoomBoostTtlMs === 'number')
        {this.activeRoomBoostTtlMs = qos.activeRoomBoostTtlMs;}
      if (typeof qos.alwaysPrioritizeActiveRoom === 'boolean')
        {this.alwaysPrioritizeActiveRoom = qos.alwaysPrioritizeActiveRoom;}
    }

    this.username = username;
    this.password = password;
    this.initializeClient();
  }

  // ===================================================================
  // QoS API — mirrors web XmppClientInterface
  // ===================================================================
  setActiveRoomJid(roomJID: string | null) {
    this.activeRoomJID = roomJID;
    if (roomJID) {this.promoteRoomHistory(roomJID);}
  }

  promoteRoomHistory(_roomJID: string) {
    this.activeRoomBoostUntil = Date.now() + this.activeRoomBoostTtlMs;
  }

  /**
   * Active-room gate is "open" whenever the boost has expired OR there's
   * room for more concurrent MAM fetches. Scheduler uses this to backoff.
   */
  isActiveRoomGateOpen(): boolean {
    if (this.mamInFlightByRoom.size >= this.maxInFlightHistory) {return false;}
    if (Date.now() < this.softPauseUntil) {return false;}
    return true;
  }

  /** Called right before a critical send. Soft-pauses background MAM. */
  onCriticalSend(roomJID: string, _messageId?: string) {
    this.softPauseUntil = Date.now() + this.softPauseAfterSendMs;
    if (roomJID) {this.promoteRoomHistory(roomJID);}
  }

  /**
   * Higher-priority presence than presenceInRoomStanza. For now just
   * delegates — kept distinct so callers don't change when full priority
   * lanes land later.
   */
  async prioritizeRoomPresence(roomJID: string): Promise<boolean> {
    try {
      this.presenceInRoomStanza(roomJID);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Queued history fetch. Coalesces by room: if the same room already has
   * a higher-priority request in flight, return that promise. Honors
   * `skipIfPreloaded` by checking redux state (lazy import to avoid cycle).
   */
  async enqueueHistoryTask(params: {
    chatJID: string;
    max: number;
    before?: number;
    id?: string;
    source?: HistorySource;
  }): Promise<any> {
    const { chatJID, max, before, id, source = 'default' } = params;

    // Coalesce — if a fetch for the same room is in-flight, reuse it
    // unless the new request is higher priority.
    const existing = this.mamInFlightByRoom.get(chatJID);
    if (existing && this.sourceRank(existing.source) <= this.sourceRank(source)) {
      return existing.promise;
    }

    // Wait for the gate (in-flight cap + soft-pause). For active-room
    // requests we still proceed past the cap when the boost is fresh.
    while (
      this.mamInFlightByRoom.size >= this.maxInFlightHistory &&
      !(this.alwaysPrioritizeActiveRoom && this.activeRoomJID === chatJID)
    ) {
      await new Promise((r) => setTimeout(r, 80));
    }
    if (Date.now() < this.softPauseUntil && source === 'background') {
      const wait = this.softPauseUntil - Date.now();
      await new Promise((r) => setTimeout(r, wait));
    }

    // Self-reference via an outer holder so the IIFE's `finally` can
    // identify "is the registry entry I started still the current one?"
    // without TS's TDZ false-positive (TS2454 on a bare `let promise`).
    const handle: { p?: Promise<any> } = {};
    handle.p = (async () => {
      try {
        return await getHistory(this.client, chatJID, max, before, id);
      } finally {
        const cur = this.mamInFlightByRoom.get(chatJID);
        if (cur && cur.promise === handle.p) {
          this.mamInFlightByRoom.delete(chatJID);
        }
      }
    })();

    this.mamInFlightByRoom.set(chatJID, {
      promise: handle.p,
      source,
      startedAt: Date.now(),
    });
    return handle.p;
  }

  private sourceRank(s: HistorySource): number {
    switch (s) {
      case 'active':
        return 0;
      case 'send_ack':
        return 1;
      case 'default':
        return 2;
      case 'background':
        return 3;
    }
  }

  initializeClient() {
    try {
      const devServer = this.devServer || DEFAULT_DEV_SERVER;
      const url = `wss://${devServer}/ws`;
      this.service = url;
      this.host =
        this.xmppSettings?.host || url.match(/wss:\/\/([^:/]+)/)?.[1] || '';
      this.conference =
        this.xmppSettings?.conference || `conference.${this.host}`;
      this.status = 'connecting';

      // Defensive: if a previous underlying client is still referenced
      // (initializeClient reached from a path other than reconnect()),
      // detach its handlers before we overwrite the ref so the orphaned
      // client can't keep dispatching stanzas into redux.
      try {
        this.detachEventListeners();
      } catch {}

      this.client = xmpp.client({
        service: url,
        username: walletToUsername(this.username),
        password: this.password,
      });

      try {
        (this.client as any)?.reconnect?.stop?.();
      } catch {}

      // Concurrent room preloads each register their own short-lived
      // 'stanza' handler (getHistory, getRooms, getChatsPrivateStore,
      // ...). With 5+ rooms preloading in parallel, Node's default
      // EventEmitter cap of 10 trips the "possible memory leak" warning
      // even though each handler is correctly unsubscribed in `finally`.
      // Raising the cap silences the warning without masking real leaks
      // — true leaks would still grow unboundedly past this number.
      try {
        (this.client as any)?.setMaxListeners?.(50);
      } catch {}

      // Wrap `send` so the dev logger sees outgoing stanzas too.
      // Guarded: some @xmpp/client builds define `send` as a getter or
      // non-writable property, and overwriting would throw silently and
      // strand the whole pipeline. We catch everything and fall back to
      // the unwrapped client.
      try {
        const origSend = this.client.send?.bind(this.client);
        if (origSend) {
          const wrapped = (stanza: any) => {
            try {
              const tag = stanza?.name || 'stanza';
              const id = stanza?.attrs?.id || '';
              const to = stanza?.attrs?.to || '';
              devPushLog(
                'xmpp',
                `→ ${tag}${id ? ` id=${id}` : ''}${to ? ` to=${to.split('/')[0]}` : ''}`,
                stanza?.toString ? stanza.toString() : undefined
              );
            } catch {}
            const result = origSend(stanza);
            // Most stanza helpers fire-and-forget `client.send(...)`
            // without awaiting/catching. On @xmpp/client builds where
            // send() returns a Promise, a transient send failure (e.g.
            // mid-reconnect) then surfaces as a red-screen "Uncaught (in
            // promise, id: N)" (#4). Attach a no-op catch so the
            // rejection is considered handled — callers that DO await/
            // catch still get it, because we return the SAME promise.
            if (result && typeof (result as any).catch === 'function') {
              (result as any).catch(() => {});
            }
            return result;
          };
          // Property may be non-writable on some builds; defineProperty
          // gives us a clearer error than a plain assignment.
          Object.defineProperty(this.client, 'send', {
            value: wrapped,
            writable: true,
            configurable: true,
          });
        }
      } catch (err) {
        console.warn(
          'XmppClient: could not wrap client.send for dev logging',
          err
        );
      }

      this.attachEventListeners();
      this.client.start().catch((error: any) => {
        console.error('Error starting xmpp client:', error);
        if (isNotAuthorizedError(error)) {
          this.lastAuthError = 'not-authorized';
        }
        this.status = 'error';
        // A connect-time failure lands in 'error', which — unlike a
        // 'disconnect' after being online — has no other retry path
        // (onError doesn't reschedule; the provider only reacts to
        // 'offline'). Schedule a backoff retry so a failed initial or
        // reconnect attempt recovers on its own. reconnect() refreshes
        // creds first when the failure was a SASL not-authorized.
        if (!this.suppressReconnect) {
          try {
            this.scheduleReconnect();
          } catch {}
        }
      });
    } catch (error) {
      console.error('Error initializing client:', error);
      this.status = 'error';
    }
  }

  // Stored so detachEventListeners() can remove exactly the handlers we
  // added (not xmpp.js's internal ones). Without this a re-login left the
  // previous instance's `stanza` handler bound, double-dispatching every
  // incoming stanza into the (new session's) redux store.
  private onDisconnect?: () => void;
  private onOnline?: () => void;
  private onError?: (error: any) => void;
  private onStanza?: (stanza: any) => void;

  attachEventListeners() {
    // Idempotent: drop any previously-attached handlers first so a
    // reconnect that re-runs initializeClient on a fresh underlying
    // client doesn't stack duplicates.
    this.detachEventListeners();

    this.onDisconnect = () => {
      console.log('XMPP disconnected.');
      this.status = 'offline';
      try {
        // lazy-require to avoid pulling devLogger into prod bundles
        // that don't reference it; tree-shaken via dead-code elim.
        devPushLog('xmpp', 'disconnect');
      } catch {}
      // Self-heal at the socket level. The provider's reconnect effect
      // keys on `client.status`, but that's a mutated class field React
      // does NOT track — so a silent socket drop (e.g. JS paused by the
      // debugger, iOS WebSocket suspend) never re-runs the effect and the
      // client sits 'offline' forever (sends then queue and time out).
      // Driving reconnect here makes recovery independent of React.
      if (!this.suppressReconnect) {
        try {
          this.scheduleReconnect();
        } catch {}
      }
    };

    this.onOnline = () => {
      console.log('XMPP online.', new Date());
      this.status = 'online';
      this.presencesReady = true;
      this.reconnectAttempts = 0;
      try {
        devPushLog(
          'xmpp',
          'online',
          this.username
        );
      } catch {}
      // Notify the provider that the session is live again. On a RECONNECT
      // (new stream) the client is no longer joined to any MUC, so the
      // provider must re-send room presences — otherwise messages get a
      // local double-tick but never reach the room (bug #21). Harmless on
      // the first connect (room list not loaded yet → joins nothing; the
      // bootstrap's own allRoomPresences handles that pass).
      try {
        this.onOnlineCallback?.();
      } catch (err) {
        console.warn('onOnline callback failed', err);
      }
      // Drain any sends that were buffered while the stream was down. The
      // presence stanzas from onOnlineCallback above were written to the
      // socket synchronously (allRoomPresences → presenceInRoom send the
      // <presence> before yielding), so flushing here puts the message
      // stanzas AFTER the joins on the same stream — XMPP's in-order
      // per-stream processing guarantees the MUC join lands first.
      try {
        this.flushPendingSends();
      } catch (err) {
        console.warn('flushPendingSends failed', err);
      }
    };

    this.onError = (error: any) => {
      console.error('XMPP client error:', error);
      if (isNotAuthorizedError(error)) {
        this.lastAuthError = 'not-authorized';
      }
      try {
        devPushLog(
          'xmpp',
          'error',
          (error && error.message) || error
        );
      } catch {}
    };

    this.onStanza = (stanza: any) => {
      try {
        const tag = stanza?.name || 'stanza';
        const id = stanza?.attrs?.id || '';
        const from = stanza?.attrs?.from || '';
        const type = stanza?.attrs?.type || '';
        devPushLog(
          'xmpp',
          `← ${tag}${id ? ` id=${id}` : ''}${type ? ` type=${type}` : ''}${from ? ` from=${from.split('/')[0]}` : ''}`,
          stanza?.toString ? stanza.toString() : undefined
        );
      } catch {}
      handleStanza.bind(this, stanza, this)();
    };

    this.client.on('disconnect', this.onDisconnect);
    this.client.on('online', this.onOnline);
    this.client.on('error', this.onError);
    this.client.on('stanza', this.onStanza);
  }

  detachEventListeners() {
    const c = this.client as any;
    if (!c?.removeListener) {return;}
    try {
      if (this.onDisconnect) {c.removeListener('disconnect', this.onDisconnect);}
      if (this.onOnline) {c.removeListener('online', this.onOnline);}
      if (this.onError) {c.removeListener('error', this.onError);}
      if (this.onStanza) {c.removeListener('stanza', this.onStanza);}
    } catch {}
    this.onDisconnect = undefined;
    this.onOnline = undefined;
    this.onError = undefined;
    this.onStanza = undefined;
  }

  /**
   * Resolves once status === 'online' or rejects when status === 'error'.
   * Mirrors the web client's `ensureConnected` helper.
   */
  waitForOnline(timeoutMs: number = 15000): Promise<void> {
    if (this.status === 'online') {return Promise.resolve();}
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.status === 'online') {return resolve();}
        if (this.status === 'error') {
          return reject(new Error('XMPP client error'));
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('XMPP connect timeout'));
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  // Alias to match the web XmppClientInterface.
  ensureConnected(timeout?: number): Promise<void> {
    return this.waitForOnline(timeout);
  }

  scheduleReconnect() {
    if (this.suppressReconnect) {return;}
    if (this.reconnecting || this.reconnectTimer) {return;}
    this.reconnectAttempts++;
    const exp = Math.min(
      this.reconnectAttempts - 1,
      Math.max(0, this.maxReconnectAttempts)
    );
    const delay = Math.min(
      this.maxReconnectDelay,
      this.reconnectDelay * Math.pow(2, exp)
    );
    console.log(`Reconnecting attempt ${this.reconnectAttempts} in ${delay}ms`);
    // No clearTimeout needed — the guard above guarantees no pending timer.
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // The connection may have recovered on its own (xmpp.js auto-
      // reconnect) between scheduling and firing — don't tear down a
      // healthy stream. forceReconnect() bypasses this by calling
      // reconnect() directly.
      if (this.status === 'online') {
        this.reconnectAttempts = 0;
        return;
      }
      this.reconnect();
    }, delay);
  }

  /**
   * Force an immediate reconnect, resetting the backoff counter. Called
   * by the provider when NetInfo reports the network came back or the app
   * returned to the foreground — we don't want to wait out the existing
   * exponential delay (or a maxed-out attempt count) in those cases.
   */
  forceReconnect() {
    if (this.suppressReconnect) {return;}
    // Debounce bursts: NetInfo restore + AppState 'active' + the provider
    // watchdog can fire within the same instant. reconnect() dedups
    // CONCURRENT calls, but sequential ones (one finishes, the next
    // arrives) would still each tear down + re-create the client. Ignore
    // forces within 2s of the last one.
    const now = Date.now();
    if (now - this.lastReconnectAt < 2000) {return;}
    this.lastReconnectAt = now;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.reconnect();
  }

  private streamAliveProbe: Promise<boolean> | null = null;

  verifyStreamAlive(timeoutMs: number = 4000): Promise<boolean> {
    if (this.status !== 'online' || !this.client) {
      return Promise.resolve(false);
    }
    if (this.streamAliveProbe) {return this.streamAliveProbe;}
    const underlying: any = this.client;
    this.streamAliveProbe = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (alive: boolean) => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timer);
        try {
          underlying.removeListener?.('stanza', onStanza);
        } catch {}
        resolve(alive);
      };
      const onStanza = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      try {
        underlying.on('stanza', onStanza);
        sendPing(underlying, this.host, `alive-${Date.now()}`);
      } catch {
        // Couldn't even write the probe — treat as dead.
        done(false);
      }
    }).finally(() => {
      this.streamAliveProbe = null;
    }) as Promise<boolean>;
    return this.streamAliveProbe;
  }

  async ensureStreamAlive(timeoutMs: number = 4000): Promise<void> {
    if (this.suppressReconnect || this.status !== 'online') {return;}
    const alive = await this.verifyStreamAlive(timeoutMs);
    // Re-check state: a reconnect may have started meanwhile.
    if (!alive && this.status === 'online' && !this.suppressReconnect) {
      try {
        devPushLog('xmpp', 'stream is zombie (ping unanswered) → forceReconnect');
      } catch {}
      this.forceReconnect();
    }
  }

  async reconnect() {
    if (this.suppressReconnect) {return;}
    // Single-flight: ignore overlapping triggers (AppState + NetInfo +
    // scheduled timer) so we never spawn two underlying clients and leak
    // one with live listeners (duplicate stanza dispatch).
    if (this.reconnecting) {
      console.log('reconnect already in progress — skip');
      return;
    }
    this.reconnecting = true;
    console.log('Attempting to reconnect xmpp client...');

    try {
      // If the last failure was a SASL `not-authorized` (typically a stale
      // JWT-derived XMPP password after idle), try to fetch fresh creds
      // before retrying. Without this, reconnect retries with the same
      // stale password forever and the user has to kill the app.
      if (this.lastAuthError === 'not-authorized' && this.credentialsProvider) {
        try {
          await this.refreshCredentialsOnce();
        } catch (err) {
          console.warn(
            'XMPP credential refresh failed; reconnecting with cached creds',
            err
          );
        }
      }

      // Tear the OLD underlying client down FULLY before spinning up a new
      // one: detach our handlers (so its `stanza` handler can't keep
      // dispatching) and stop it. detachEventListeners() must run while
      // `this.client` still points at the old client — i.e. before
      // initializeClient() reassigns it.
      const old = this.client;
      if (old) {
        this.detachEventListeners();
        try {
          await old.stop();
        } catch {}
      }
      this.initializeClient();
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Single-flight wrapper around credentialsProvider. Multiple concurrent
   * reconnect() calls (e.g. from the provider's reconnect effect firing
   * twice quickly) share one in-flight request and update `this.password`
   * exactly once.
   */
  private refreshCredentialsOnce(): Promise<void> {
    if (this.credentialsRefreshInFlight) {return this.credentialsRefreshInFlight;}
    if (!this.credentialsProvider) {return Promise.resolve();}
    const provider = this.credentialsProvider;
    this.credentialsRefreshInFlight = (async () => {
      try {
        const fresh = await provider();
        if (fresh?.username && fresh?.password) {
          // Apply whatever the provider returns and retry. We do NOT try to
          // detect "auth expired" by comparing passwords — a stable
          // xmppPassword (e.g. deterministic from the JWT/wallet) is the
          // NORMAL case for a transient blip, and treating it as expiry
          // falsely bricked recoverable sessions (sending stopped). If the
          // creds really are stale we simply get not-authorized again and
          // retry, which is the confirmed-good 26.5.7 behaviour.
          this.updateCredentials(fresh.username, fresh.password);
          this.lastAuthError = null;
        }
      } finally {
        this.credentialsRefreshInFlight = null;
      }
    })();
    return this.credentialsRefreshInFlight;
  }

  async disconnect(options?: { suppressReconnect?: boolean }): Promise<void> {
    if (options?.suppressReconnect) {this.suppressReconnect = true;}
    return this.close();
  }

  async close() {
    // Cancel any pending reconnect so a stale timer can't resurrect this
    // instance after teardown/logout.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      // Detach OUR handlers first so a late stanza during the close
      // handshake can't re-enter handleStanza and dispatch into a store
      // that's being wiped (or, on re-login, the new session's store).
      this.detachEventListeners();
      try {
        await this.client.stop();
        console.log('XMPP client connection closed.');
      } catch (error) {
        console.error('Error closing the xmpp client:', error);
      }
    }
    this.status = 'offline';
    this.presencesReady = false;
    // Permanent teardown (logout / unmount) — drop buffered sends so they
    // don't replay into the next session. Reconnect uses old.stop(), NOT
    // close(), so the queue still survives a transient drop+reconnect.
    clearOutboundSends();
  }

  getRoomsStanza = async () => {
    await getRooms(this.client);
  };

  //room functions

  async createRoomStanza(title: string, description: string, to?: string) {
    return await createRoom(title, description, this.client);
  }

  async inviteRoomRequestStanza(to: string, roomJid: string) {
    await inviteRoomRequest(this.client, to, roomJid);
  }

  leaveTheRoomStanza = (roomJID: string) => {
    leaveTheRoom(normalizeRoomJid(roomJID, this.conference), this.client);
  };

  presenceInRoomStanza = (roomJID: string) => {
    presenceInRoom(this.client, normalizeRoomJid(roomJID, this.conference));
  };

  getHistoryStanza = async (
    chatJID: string,
    max: number,
    before?: number,
    id?: string,
    options?: HistoryOptions
  ) => {
    if (options?.coalesceRoom) {
      return this.enqueueHistoryTask({
        chatJID,
        max,
        before,
        id,
        source: options?.source || 'default',
      });
    }
    return await getHistory(this.client, chatJID, max, before, id);
  };

  getLastMessageArchiveStanza(roomJID: string) {
    getLastMessage(this.client, normalizeRoomJid(roomJID, this.conference));
  }

  setRoomImageStanza = (
    roomJid: string,
    roomThumbnail: string,
    type: string,
    roomBackground?: string
  ) => {
    setRoomImage(roomJid, roomThumbnail, type, this.client, roomBackground);
  };

  getRoomInfoStanza = (roomJID: string) => {
    getRoomInfo(normalizeRoomJid(roomJID, this.conference), this.client);
  };

  getRoomMembersStanza = (roomJID: string) => {
    getRoomMembers(normalizeRoomJid(roomJID, this.conference), this.client);
  };

  /**
   * True when the underlying stream is live enough to actually put a
   * stanza on the wire. Used to gate sends: when false we buffer instead
   * of firing a fire-and-forget stanza into a dead/half-open socket
   * (which is silently dropped and only caught by the 30s watchdog).
   */
  private isStreamReady(): boolean {
    return !!this.client && this.status === 'online' && !this.reconnecting;
  }

  /** Replay buffered sends against this (now-online) client, in order. */
  flushPendingSends() {
    flushOutboundSends(this, Date.now());
  }

  //messages
  sendMessage = (
    roomJID: string,
    firstName: string,
    lastName: string,
    photo: string,
    walletAddress: string,
    userMessage: string,
    notDisplayedValue?: string,
    isReply?: boolean,
    showInChannel?: boolean,
    mainMessage?: string,
    customId?: string
  ): boolean => {
    // Stream down (start race / reconnect window): buffer and replay on
    // the next 'online' instead of losing the stanza. Returns false so
    // callers know the send was deferred, not delivered.
    if (!this.isStreamReady()) {
      enqueueOutboundSend({
        optimisticId: customId || `send-text-message-${Date.now()}`,
        roomJID,
        enqueuedAt: Date.now(),
        send: (c) =>
          c.sendMessage(
            roomJID,
            firstName,
            lastName,
            photo,
            walletAddress,
            userMessage,
            notDisplayedValue,
            isReply,
            showInChannel,
            mainMessage,
            customId
          ),
      });
      return false;
    }
    sendTextMessage(
      this.client,
      roomJID,
      firstName,
      lastName,
      photo,
      walletAddress,
      userMessage,
      notDisplayedValue,
      isReply,
      showInChannel,
      mainMessage,
      this.devServer || DEFAULT_DEV_SERVER,
      customId
    );
    return true;
  };

  deleteMessageStanza(room: string, msgId: string) {
    deleteMessage(this.client, room, msgId);
  }

  editMessageStanza(room: string, msgId: string, text: string) {
    editMessage(this.client, room, msgId, text);
  }

  sendTypingRequestStanza(chatId: string, fullName: string, start: boolean) {
    sendTypingRequest(this.client, chatId, fullName, start);
  }

  getChatsPrivateStoreRequestStanza = async () => {
    if (this.disableLastRead) {return null;}
    try {
      const markers = await getChatsPrivateStoreRequest(this.client);
      // Hydrate the fetched server-side read markers into redux. Without
      // this the markers were fetched on every init/reconnect and then
      // silently dropped, so any room the user hadn't locally opened+left
      // this session kept `lastViewedTimestamp: 0` and the unread
      // middleware's `> 0` gate skipped it forever — `useUnread()` stayed
      // at 0 with no badge. Done here on the single READ method so every
      // caller (provider init, reconnect, ChatWrapper, push handlers, …)
      // hydrates automatically and a future caller can't reintroduce the
      // drop. The write helpers call the lower-level
      // `getChatsPrivateStoreRequest` directly and intentionally skip this.
      if (markers && typeof markers === 'object') {
        const normalized: Record<string, number> = {};
        for (const jid of Object.keys(markers as Record<string, unknown>)) {
          const n = Number((markers as Record<string, unknown>)[jid]);
          if (jid && Number.isFinite(n) && n > 0) {normalized[jid] = n;}
        }
        if (Object.keys(normalized).length > 0) {
          store.dispatch(applyPrivateStoreMarkers(normalized));
        }
      }
      return markers;
    } catch (error) {
      console.log(error);
      return null;
    }
  };

  async actionSetTimestampToPrivateStoreStanza(
    chatId: string,
    timestamp: number,
    chats?: string[]
  ) {
    if (this.disableLastRead) {return;}
    try {
      await actionSetTimestampToPrivateStore(
        this.client,
        chatId,
        timestamp,
        chats
      );
    } catch (error) {}
  }

  // Flush lastViewedTimestamp for every room into the server's private
  // store. Used by AppState/background and tab-change handlers — see
  // src/networking/xmpp/flushLastViewedToPrivateStore.ts for details.
  async flushLastViewedToPrivateStoreStanza(
    rooms: Record<string, any> | null | undefined,
    opts: { visibleRoomJID?: string | null; onlyIfNoUnread?: boolean } = {}
  ) {
    if (this.disableLastRead) {return false;}
    try {
      return await flushLastViewedToPrivateStore(this, rooms, opts);
    } catch {
      return false;
    }
  }

  sendMediaMessageStanza(roomJID: string, data: any, customId?: string) {
    // Media: the file is already uploaded by the time we get here; only the
    // stanza needs the stream. Buffer + replay on reconnect if it's down so
    // the upload isn't wasted (otherwise the stanza is lost and the media
    // bubble sits pending until the 30s watchdog fails it).
    if (!this.isStreamReady()) {
      enqueueOutboundSend({
        optimisticId: customId || `send-media-message-${Date.now()}`,
        roomJID,
        enqueuedAt: Date.now(),
        send: (c) => c.sendMediaMessageStanza(roomJID, data, customId),
      });
      return undefined;
    }
    return sendMediaMessage(
      this.client,
      roomJID,
      data,
      customId,
      this.devServer || DEFAULT_DEV_SERVER
    );
  }

  // -------------------------------------------------------------------
  // Method stubs to satisfy `XmppClientInterface`. Concrete RN xmpp
  // helpers don't exist yet — the stubs log a single warning and no-op
  // so consumers don't blow up at runtime. Replace with real impls when
  // their `*.xmpp.ts` helpers are ported from the web side.
  // -------------------------------------------------------------------

  setVCardStanza(_xmppUsername: string) {
    console.warn('setVCardStanza: not implemented in RN xmpp client');
  }

  async createPrivateRoomStanza(
    title: string,
    description: string,
    to: string
  ): Promise<string> {
    console.warn('createPrivateRoomStanza: not implemented; falling back to createRoom');
    const result = await this.createRoomStanza(title, description, to);
    return typeof result === 'string' ? result : '';
  }

  sendMessageReactionStanza(
    _messageId: string,
    _roomJid: string,
    _reactionsList: string[],
    _reactionSymbol?: string
  ) {
    console.warn('sendMessageReactionStanza: not implemented in RN xmpp client');
  }

  sendTextMessageWithTranslateTagStanza(
    roomJID: string,
    firstName: string,
    lastName: string,
    photo: string,
    walletAddress: string,
    userMessage: string,
    notDisplayedValue?: string,
    isReply?: boolean,
    showInChannel?: boolean,
    mainMessage?: string,
    _langSource?: string,
    customId?: string
  ) {
    // No translate tag support yet — fall back to a regular text send.
    // Forward the caller's customId so the optimistic message (heap/redux)
    // reconciles with the server echo. Without it, translated sends went
    // out with no client id → the echo carried a server-assigned id and
    // surfaced as a stuck-pending message PLUS a duplicate (affected both
    // the live translated-send path and resend).
    this.sendMessage(
      roomJID,
      firstName,
      lastName,
      photo,
      walletAddress,
      userMessage,
      notDisplayedValue,
      isReply,
      showInChannel,
      mainMessage,
      customId
    );
  }
}

export default XmppClient;
