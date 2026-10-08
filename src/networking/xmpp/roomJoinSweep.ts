import type { Client } from '@xmpp/client';
import { store } from '../../roomStore';
import { presenceInRoom } from './presenceInRoom.xmpp';
import {
  allRoomPresences,
  AllRoomPresenceSummary,
} from './allRoomPresences.xmpp';
import { isLikelyMucJid } from '../../helpers/isLikelyMucJid';
import { getRoomLastActivityScore } from '../../helpers/roomActivityScore';
import type { HistoryQoSConfig } from '../../types/types';

/**
 * The slice of XmppClient the join manager needs. Keeping it an interface
 * keeps this file free of an import cycle with xmppClient.ts.
 */
export interface RoomJoinHost {
  /** The underlying @xmpp/client (changes on every reconnect). */
  getClient: () => Client | undefined;
  /** Bumped on every disconnect / reconnect / close. */
  getConnectionEpoch: () => number;
  /** True while the stream is online (join then needs no wait). */
  isOnline?: () => boolean;
  /** Resolves when the stream is online, rejects on timeout. */
  waitForOnline: (timeoutMs?: number) => Promise<void>;
  /** MUC conference domain of this server (custom domains allowed). */
  getConference?: () => string;
  getHistoryQoS: () => HistoryQoSConfig | undefined;
}

export interface EnsureRoomPresenceOptions {
  /** Extra wait after the room answered. Default 0. */
  settleDelay?: number;
  /** How long this caller waits for the join. Default 2000. */
  timeoutMs?: number;
  /** false: fire the join and return true at once. Default true. */
  waitForJoin?: boolean;
  source?: 'active_room' | 'send' | 'background' | 'other';
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const SWEEP_RETRY_DELAYS_MS = [2000, 5000, 10000];
const DEFAULT_JOIN_CONCURRENCY = 5;
const DEFAULT_FAILURE_BACKOFF_MS = 10000;

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const emptySummary = (): AllRoomPresenceSummary => ({
  total: 0,
  success: 0,
  failed: 0,
  failedRooms: [],
  sweptRooms: [],
  failures: [],
});

/**
 * Per-connection MUC join state and the background join sweep.
 *
 * Why it exists: the RN client used to join every room with a Promise.all
 * and only then call the session ready, so the room list waited for the
 * slowest of N joins and a join in flight when the socket dropped could
 * poison the next connection. Here joins go through one dedup layer
 * (ensureRoomPresence), the sweep is a bounded pool that runs in the
 * background (active room first, then by recent activity), and every join
 * remembers the connection epoch it started on: when the socket was
 * replaced meanwhile its outcome is discarded (no joined mark, no backoff).
 *
 * `presencesReady` means the whole sweep finished, `priorityPresencesReady`
 * that its first wave (active room + one pool width) settled.
 */
export class RoomJoinManager {
  presencesReady = false;
  priorityPresencesReady = false;
  joinedRooms: Set<string> = new Set();
  roomPresenceInFlight: Map<string, Promise<boolean>> = new Map();
  roomPresenceBlockedUntil: Map<string, number> = new Map();
  sweepRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepRetryRunning = false;
  private sendAllPresencesInFlight: Promise<void> | null = null;

  constructor(private readonly host: RoomJoinHost) {}

  // ---- config -------------------------------------------------------
  private qos(): HistoryQoSConfig {
    const own = this.host.getHistoryQoS() || {};
    let fromConfig: HistoryQoSConfig = {};
    try {
      fromConfig =
        (store.getState() as any)?.chatSettingStore?.config?.historyQoS || {};
    } catch {
      fromConfig = {};
    }
    return { ...fromConfig, ...own };
  }

  get joinConcurrency(): number {
    return Math.max(
      1,
      Math.floor(Number(this.qos().joinConcurrency) || DEFAULT_JOIN_CONCURRENCY)
    );
  }

  get joinHistoryStanzas(): number {
    return Math.max(0, Math.floor(Number(this.qos().joinHistoryStanzas) || 0));
  }

  private get failureBackoffMs(): number {
    return Math.max(
      0,
      Number(this.qos().presenceFailureBackoffMs || DEFAULT_FAILURE_BACKOFF_MS)
    );
  }

  private get epoch(): number {
    return this.host.getConnectionEpoch();
  }

  // A room the sweep may fan out over: a conference-domain JID (or the
  // server's own, possibly custom, conference domain).
  private isValidRoomJid(jid: unknown): jid is string {
    if (isLikelyMucJid(jid)) {return true;}
    if (typeof jid !== 'string') {return false;}
    const conference = this.host.getConference?.();
    const at = jid.indexOf('@');
    return (
      !!conference && at > 0 && jid.slice(at + 1).split('/')[0] === conference
    );
  }

  // An explicit join of one room (a send, an open room, an invite) only
  // needs a well-formed `local@domain`: the caller named the room.
  private isJoinableJid(jid: unknown): jid is string {
    if (typeof jid !== 'string') {return false;}
    const at = jid.indexOf('@');
    return at > 0 && at < jid.length - 1;
  }

  // ---- lifecycle ----------------------------------------------------
  /** Called on every disconnect / reconnect / close: nothing carries over. */
  reset() {
    this.presencesReady = false;
    this.priorityPresencesReady = false;
    this.clearSweepRetry();
    this.sendAllPresencesInFlight = null;
    this.joinedRooms.clear();
    this.roomPresenceInFlight.clear();
    this.roomPresenceBlockedUntil.clear();
  }

  isJoined(roomJid: string): boolean {
    return this.joinedRooms.has(roomJid);
  }

  // ---- one room -----------------------------------------------------
  ensureRoomPresence = async (
    roomJID: string,
    options?: EnsureRoomPresenceOptions
  ): Promise<boolean> => {
    if (!roomJID) {return true;}
    const source = options?.source || 'other';
    if (!this.isJoinableJid(roomJID)) {
      console.warn(
        `[XMPP] room_presence_skipped_invalid_jid jid=${String(roomJID)} source=${source}`
      );
      // Block for a long time so repeated callers don't keep retrying.
      this.roomPresenceBlockedUntil.set(roomJID, Date.now() + DAY_MS);
      return false;
    }
    if (this.joinedRooms.has(roomJID)) {return true;}
    const blockedUntil = this.roomPresenceBlockedUntil.get(roomJID) || 0;
    if (Date.now() < blockedUntil) {return false;}

    const settleDelay = options?.settleDelay ?? 0;
    const timeoutMs = options?.timeoutMs ?? 2000;
    const waitForJoin = options?.waitForJoin ?? true;

    const existing = this.roomPresenceInFlight.get(roomJID);
    if (existing) {
      if (!waitForJoin) {return true;}
      // Piggyback on someone else's in-flight join but never wait past OUR
      // OWN budget: that join may have been started with a longer timeout
      // (the sweep uses 5 s, a send wants less).
      const OWN_TIMEOUT = Symbol('ensureRoomPresence_own_timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ownTimeout = new Promise<typeof OWN_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(OWN_TIMEOUT), timeoutMs);
      });
      const result = await Promise.race([existing, ownTimeout]);
      if (timer) {clearTimeout(timer);}
      return result === OWN_TIMEOUT ? false : result;
    }

    // A join that outlives its connection (socket dropped while it waited)
    // must not write into the NEW connection's state: neither joined nor a
    // failure backoff.
    const joinEpoch = this.epoch;
    const promise: Promise<boolean> = (async () => {
      // Online: go straight to the write (synchronously for the first
      // caller), so a send queued right behind it stays ordered after it.
      if (!this.host.isOnline?.()) {
        await this.host.waitForOnline(Math.max(timeoutMs, 1000));
      }
      if (joinEpoch !== this.epoch) {return false;}
      const client = this.host.getClient();
      if (!client) {return false;}
      await presenceInRoom(
        client,
        roomJID,
        settleDelay,
        timeoutMs,
        this.joinHistoryStanzas
      );
      if (joinEpoch !== this.epoch) {return false;}
      this.joinedRooms.add(roomJID);
      this.roomPresenceBlockedUntil.delete(roomJID);
      return true;
    })()
      .catch((error) => {
        if (joinEpoch !== this.epoch) {return false;}
        const message = formatError(error);
        // Permanent / long-lived failures: "you are not a member" or "this
        // room does not exist". No point retrying for an hour.
        const isHardFailure =
          message.includes('presence_error:forbidden') ||
          message.includes('presence_error:not-allowed') ||
          message.includes('presence_error:remote-server-not-found') ||
          message.includes('presence_error:item-not-found') ||
          message.includes('presence_invalid_jid');
        if (isHardFailure) {
          this.roomPresenceBlockedUntil.set(roomJID, Date.now() + 60 * 60 * 1000);
        } else if (
          message.includes('presence_timeout') ||
          message.includes('presence_send_failed') ||
          message.includes('presence_error')
        ) {
          this.roomPresenceBlockedUntil.set(
            roomJID,
            Date.now() + this.failureBackoffMs
          );
        }
        console.warn(
          `[XMPP] room_presence_failed room=${roomJID} source=${source} error=${message}`
        );
        return false;
      })
      .finally(() => {
        // The map was cleared on disconnect: only drop our own entry.
        if (this.roomPresenceInFlight.get(roomJID) === promise) {
          this.roomPresenceInFlight.delete(roomJID);
        }
      });

    this.roomPresenceInFlight.set(roomJID, promise);
    if (waitForJoin) {return promise;}
    return true;
  };

  // ---- the sweep ----------------------------------------------------
  /**
   * Start the background join sweep. Every caller shares one in-flight
   * sweep; a finished sweep is only repeated when rooms appeared since.
   * Never throws.
   */
  async sendAllPresencesAndMarkReady(): Promise<void> {
    if (this.sendAllPresencesInFlight) {return this.sendAllPresencesInFlight;}
    if (this.presencesReady && !this.hasUnjoinedRooms()) {return;}
    const run: Promise<void> = this.runAllPresencesSweep().finally(() => {
      if (this.sendAllPresencesInFlight === run) {
        this.sendAllPresencesInFlight = null;
      }
    });
    this.sendAllPresencesInFlight = run;
    return run;
  }

  // Store rooms this connection has not joined and is not backing off from.
  private hasUnjoinedRooms(): boolean {
    const rooms = store.getState().rooms.rooms;
    const now = Date.now();
    return Object.keys(rooms || {}).some(
      (jid) =>
        this.isValidRoomJid(jid) &&
        !this.joinedRooms.has(jid) &&
        now >= (this.roomPresenceBlockedUntil.get(jid) || 0)
    );
  }

  private async runAllPresencesSweep(): Promise<void> {
    const epoch = this.epoch;
    this.presencesReady = false;
    let summary = emptySummary();
    try {
      summary = await this.allRoomPresencesStanza(epoch);
    } catch (error) {
      console.warn(`[XMPP] allRoomPresences fallback reason=${formatError(error)}`);
    }
    // The connection dropped mid-sweep: a newer connection owns the state.
    if (epoch !== this.epoch) {return;}
    // Only rooms the sweep actually sent a presence for count as joined.
    // Reading the store here would also mark rooms discovered DURING the
    // sweep, and ensureRoomPresence would then short-circuit for them.
    summary.sweptRooms.forEach((jid) => {
      if (!summary.failedRooms.includes(jid)) {this.joinedRooms.add(jid);}
    });
    if (summary.failed > 0 && summary.failures?.length) {
      const text = summary.failures
        .slice(0, 3)
        .map((item) => `${item.roomJid}:${item.reason}`)
        .join(' | ');
      console.warn(`[XMPP] allRoomPresences failures_top3=${text}`);
    }
    this.priorityPresencesReady = true;
    this.presencesReady = true;
    this.scheduleSweepRetry(epoch, 0);
  }

  private clearSweepRetry() {
    if (this.sweepRetryTimer) {clearTimeout(this.sweepRetryTimer);}
    this.sweepRetryTimer = null;
    this.sweepRetryRunning = false;
  }

  // Rooms the connection has not joined that a retry can still help: not
  // joined, not under a long (hard) block. Returns the soonest moment a retry
  // is worthwhile (0 = now) or null when nothing is left.
  private nextSweepRetryAt(): number | null {
    const rooms = store.getState().rooms?.rooms;
    const now = Date.now();
    let soonest: number | null = null;
    Object.keys(rooms || {}).forEach((jid) => {
      if (!this.isValidRoomJid(jid) || this.joinedRooms.has(jid)) {return;}
      const until = this.roomPresenceBlockedUntil.get(jid) || 0;
      // Hard failures (1 h) and invalid JIDs (24 h) are not worth a retry.
      if (until - now > Math.max(this.failureBackoffMs, 1000) * 2) {return;}
      const at = Math.max(until, now);
      if (soonest === null || at < soonest) {soonest = at;}
    });
    return soonest;
  }

  private scheduleSweepRetry(epoch: number, round: number) {
    if (epoch !== this.epoch) {return;}
    if (round >= SWEEP_RETRY_DELAYS_MS.length) {return;}
    const at = this.nextSweepRetryAt();
    if (at === null) {return;}
    if (this.sweepRetryTimer) {clearTimeout(this.sweepRetryTimer);}
    const delay = Math.max(SWEEP_RETRY_DELAYS_MS[round], at - Date.now() + 100);
    this.sweepRetryTimer = setTimeout(() => {
      this.sweepRetryTimer = null;
      this.runSweepRetry(epoch, round).catch(() => undefined);
    }, delay);
  }

  private async runSweepRetry(epoch: number, round: number) {
    if (epoch !== this.epoch || !this.host.getClient()) {return;}
    // A fresh full sweep owns the pool right now: try again after it.
    if (this.sweepRetryRunning || this.sendAllPresencesInFlight) {
      this.scheduleSweepRetry(epoch, round);
      return;
    }
    if (this.nextSweepRetryAt() === null) {return;}
    this.sweepRetryRunning = true;
    try {
      const summary = await this.allRoomPresencesStanza(epoch);
      if (epoch !== this.epoch) {return;}
      const failed = new Set(summary.failedRooms);
      summary.sweptRooms.forEach((jid) => {
        if (!failed.has(jid)) {this.joinedRooms.add(jid);}
      });
    } catch (error) {
      console.warn(`[XMPP] sweep_retry:error ${formatError(error)}`);
    } finally {
      this.sweepRetryRunning = false;
    }
    this.scheduleSweepRetry(epoch, round + 1);
  }

  async allRoomPresencesStanza(
    epoch: number = this.epoch
  ): Promise<AllRoomPresenceSummary> {
    const client = this.host.getClient();
    if (!client) {return emptySummary();}
    try {
      return await allRoomPresences(
        client,
        (roomJid) =>
          this.ensureRoomPresence(roomJid, {
            settleDelay: 0,
            timeoutMs: 5000,
            waitForJoin: true,
            source: 'background',
          }),
        {
          concurrency: this.joinConcurrency,
          isJoined: (jid) => this.joinedRooms.has(jid),
          getActiveRoomJid: () => store.getState().rooms.activeRoomJID,
          rank: (jid) =>
            getRoomLastActivityScore(store.getState().rooms.rooms?.[jid]),
          isCancelled: () => epoch !== this.epoch,
          isRoomJid: (jid) => this.isValidRoomJid(jid),
          onPriorityDone: () => {
            if (epoch === this.epoch) {this.priorityPresencesReady = true;}
          },
        }
      );
    } catch (error) {
      console.warn(`[XMPP] allRoomPresencesStanza:error ${formatError(error)}`);
      return emptySummary();
    }
  }
}
