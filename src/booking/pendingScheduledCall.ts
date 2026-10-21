import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../roomStore';
import { openRoomFromPush } from '../helpers/pushPayload';
import { normalizeRoomJid } from '../helpers/normalizeRoomJid';
import {
  getScheduledCall,
  isScheduledCallApiError,
} from '../networking/api-requests/scheduledCalls.api';
import { parseScheduledCallLink } from './scheduledCallLink';
import { chatNameOfRoom } from './scheduledCall';
import { scheduledCallUi } from './scheduledCallStore';

/**
 * Opening a scheduled call from a link or a reminder push.
 *
 * A link can arrive while the app is still starting: before the user is
 * signed in, or before `<Chat>` has configured the store and connected. The
 * slug is then held (in memory, and in AsyncStorage so a cold start that
 * is interrupted by the sign-in screen keeps it) and opened once both are
 * true. Opening = resolve the slug through the API, open its room, show the
 * pre-join sheet. No media starts before the user taps Join.
 */

export const PENDING_SCHEDULED_CALL_KEY = 'ethora_pending_scheduled_call';
/** A link older than this is dropped instead of ambushing the user later. */
export const PENDING_SCHEDULED_CALL_TTL_MS = 30 * 60 * 1000;

export interface PendingStorage {
  read(): Promise<{ slug: string; at: number } | null>;
  write(value: { slug: string; at: number }): Promise<void>;
  clear(): Promise<void>;
}

export const asyncPendingStorage: PendingStorage = {
  async read() {
    try {
      const raw = await AsyncStorage.getItem(PENDING_SCHEDULED_CALL_KEY);
      if (!raw) {return null;}
      const parsed = JSON.parse(raw);
      return typeof parsed?.slug === 'string' && Number.isFinite(parsed?.at)
        ? { slug: parsed.slug, at: parsed.at }
        : null;
    } catch {
      return null;
    }
  },
  async write(value) {
    try {
      await AsyncStorage.setItem(PENDING_SCHEDULED_CALL_KEY, JSON.stringify(value));
    } catch {
      // Memory still holds it.
    }
  },
  async clear() {
    try {
      await AsyncStorage.removeItem(PENDING_SCHEDULED_CALL_KEY);
    } catch {
      // Nothing to do.
    }
  },
};

export interface PendingQueueDeps {
  /** Signed in AND the chat is configured and connected. */
  isReady: () => boolean;
  /** Opens the call; called once per held link, when ready. */
  open: (slug: string) => void;
  storage: PendingStorage;
  now?: () => number;
  ttlMs?: number;
}

/**
 * The hold-until-ready logic, free of the store so it can be tested. One
 * slot: a newer link replaces an older one (the user tapped it last).
 */
export const createPendingScheduledCallQueue = (deps: PendingQueueDeps) => {
  const now = deps.now || Date.now;
  const ttl = deps.ttlMs ?? PENDING_SCHEDULED_CALL_TTL_MS;
  let held: { slug: string; at: number } | null = null;
  let restored = false;

  const fresh = (entry: { slug: string; at: number } | null) =>
    !!entry && now() - entry.at <= ttl;

  const flush = (): boolean => {
    if (!held) {return false;}
    if (!fresh(held)) {
      held = null;
      void deps.storage.clear();
      return false;
    }
    if (!deps.isReady()) {return false;}
    const { slug } = held;
    held = null;
    void deps.storage.clear();
    deps.open(slug);
    return true;
  };

  return {
    /** A link arrived: open it now, or hold it. Returns what happened. */
    submit(slug: string): 'opened' | 'held' {
      held = { slug, at: now() };
      if (flush()) {return 'opened';}
      void deps.storage.write(held);
      return 'held';
    },
    /** Something that can make us ready changed. */
    poke(): boolean {
      return flush();
    },
    /** Pick up a link persisted by an earlier run of the app. */
    async restore(): Promise<void> {
      if (restored) {return;}
      restored = true;
      const saved = await deps.storage.read();
      // A link that arrived while we were reading is newer: keep it.
      if (!held && saved && fresh(saved)) {
        held = saved;
      } else if (!fresh(saved)) {
        void deps.storage.clear();
      }
      flush();
    },
    peek: () => held,
    reset() {
      held = null;
      restored = false;
    },
  };
};

export const isScheduledCallReady = (): boolean => {
  const settings = store.getState().chatSettingStore;
  return (
    !!settings.user?.token &&
    settings.config !== undefined &&
    (settings.connection === 'online' || settings.connection === 'syncing')
  );
};

const reportOpenError = (
  slug: string,
  reason: 'not-found' | 'not-a-member' | 'cancelled' | 'network'
): void => {
  try {
    store
      .getState()
      .chatSettingStore.config?.scheduledCalls?.onOpenError?.({ slug, reason });
  } catch {
    // A host callback must not break the flow.
  }
};

/** Resolve the slug, open its room, show the pre-join sheet. */
export const resolveAndOpenScheduledCall = async (
  slug: string
): Promise<void> => {
  scheduledCallUi.showPreJoin({ phase: 'loading', slug });
  let detail;
  try {
    detail = await getScheduledCall(slug);
  } catch (error) {
    const code = isScheduledCallApiError(error) ? error.code : 'unknown';
    const reason =
      code === 'not-a-member'
        ? 'not-a-member'
        : code === 'not-found'
          ? 'not-found'
          : 'network';
    scheduledCallUi.showPreJoin({ phase: 'error', slug, reason });
    reportOpenError(slug, reason);
    return;
  }
  if (detail.scheduledCall.status === 'cancelled') {
    scheduledCallUi.showPreJoin({
      phase: 'error',
      slug,
      reason: 'cancelled',
      title: detail.scheduledCall.title,
    });
    reportOpenError(slug, 'cancelled');
    return;
  }
  const conference = store.getState().chatSettingStore.config?.xmppSettings?.conference;
  const jid =
    detail.chat?.jid ||
    normalizeRoomJid(
      detail.chat?.name || chatNameOfRoom(detail.scheduledCall.chatName),
      conference
    );
  if (jid) {openRoomFromPush(jid);}
  scheduledCallUi.showPreJoin({ phase: 'ready', slug, detail });
};

const queue = createPendingScheduledCallQueue({
  isReady: isScheduledCallReady,
  open: (slug) => {
    void resolveAndOpenScheduledCall(slug);
  },
  storage: asyncPendingStorage,
});

let unsubscribe: (() => void) | null = null;

/**
 * Watches the store so a held link opens the moment sign-in and the chat
 * are both there. Idempotent; `<Chat>` arms it on import and
 * `openScheduledCall` arms it too, so a link that beats `<Chat>` is not lost.
 */
export const installScheduledCallHook = (): void => {
  if (unsubscribe) {return;}
  unsubscribe = store.subscribe(() => {
    if (queue.peek()) {queue.poke();}
  });
  void queue.restore();
};

/**
 * Open a scheduled call by slug: now when the user is signed in and the
 * chat is up, otherwise as soon as both are true. Returns `'opening'` when
 * it started right away and `'pending'` when it is held.
 */
export const openScheduledCall = (slug: string): 'opening' | 'pending' => {
  installScheduledCallHook();
  return queue.submit(slug) === 'opened' ? 'opening' : 'pending';
};

/**
 * Hand any URL to the SDK: a scheduled-call link is opened (or held) and
 * `true` is returned; anything else returns `false` untouched.
 */
export const handleScheduledCallUrl = (url: string | null | undefined): boolean => {
  const slug = parseScheduledCallLink(url);
  if (!slug) {return false;}
  openScheduledCall(slug);
  return true;
};

/** The reminder push the backend sends 10 minutes before a call. */
export const SCHEDULED_CALL_REMINDER_PUSH_TYPE = 'scheduledCallReminder';

export const isScheduledCallReminderPush = (
  data: Record<string, unknown> | null | undefined
): boolean => String(data?.type || '') === SCHEDULED_CALL_REMINDER_PUSH_TYPE;

/** Slug of a reminder push: `slug`, else parsed out of `joinUrl`. */
export const scheduledCallSlugFromPush = (
  data: Record<string, unknown> | null | undefined
): string | null => {
  if (!isScheduledCallReminderPush(data)) {return null;}
  const slug = String(data?.slug || '').trim();
  if (/^[A-Za-z0-9_-]{16,128}$/.test(slug)) {return slug;}
  return parseScheduledCallLink(String(data?.joinUrl || ''));
};

/** A tap on the reminder push opens the same flow as the join link. */
export const handleScheduledCallPush = (
  data: Record<string, unknown> | null | undefined
): boolean => {
  const slug = scheduledCallSlugFromPush(data);
  if (!slug) {return false;}
  openScheduledCall(slug);
  return true;
};

export const __resetPendingScheduledCallForTests = (): void => {
  queue.reset();
  unsubscribe?.();
  unsubscribe = null;
};
