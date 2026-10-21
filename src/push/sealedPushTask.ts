import { AppState, Platform } from 'react-native';
import { pushLog } from '../utils/devLogger';
import { isCallPush } from '../helpers/callPush';
import { loadPushSecretKey } from './pushKeyStore';
import {
  isReactionPush,
  openSealedPush,
  sealedPushEnvelopeOf,
  type OpenSealedPushResult,
} from './sealedPush';

// Android half of encrypted pushes. A sealed push is data-only, so the OS
// shows nothing by itself: expo-notifications hands it to a background
// task (expo-task-manager, foreground, background and killed app alike)
// and this task opens the box and posts the notification. iOS does the
// same in the notification service extension; here `registerSealedPushTask`
// is a no-op.
//
// Both packages are optional peers, required lazily: a host that does not
// want encrypted pushes never pays for them.

export const SEALED_PUSH_TASK = 'ETHORA_SEALED_PUSH';

export interface SealedPushTaskOptions {
  /** Android notification channel; the OS default channel when omitted. */
  channelId?: string;
  /**
   * Channel for a reaction to the user's message (a silent one, Telegram's
   * way); `channelId` when omitted. Reactions carry no sound of their own
   * either way.
   */
  reactionChannelId?: string;
  /** Shown when the box does not open (no key, another key, damaged). Default "New message". */
  placeholderTitle?: string;
  placeholderBody?: string;
  /**
   * An incoming-call push (data-only, high priority) while the app is not
   * in the foreground; the host shows its own incoming-call notification
   * (full-screen intent, Answer / Decline). Not called in the foreground,
   * where the XMPP invite rings the in-app call screen.
   */
  onCallPush?: (data: Record<string, unknown>) => void | Promise<void>;
  onMessageShown?: (shown: ShownMessagePush) => void | Promise<void>;
}

export interface ShownMessagePush {
  identifier: string;
  channelId?: string;
  title: string;
  body: string;
  sender: string;
  senderJid: string;
  chat: string;
  chatJid: string;
  image: string;
  reaction: boolean;
}

const PLACEHOLDER_TITLE = 'New message';
const PLACEHOLDER_REACTION_TITLE = 'New reaction';

let registered = false;

const loadTaskManager = (): any => {
  try {
    return require('expo-task-manager');
  } catch {
    return null;
  }
};

const loadNotifications = (): any => {
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
};

/**
 * The FCM data map out of the task payload. expo-notifications passes the
 * message as `{ notification, data }`; the data keys are on `data`
 * itself, `data.dataString` carries the same as a JSON string on some
 * versions, and a Firebase `RemoteMessage` keeps them under `data.data`.
 */
const pushDataCandidates = (payload: unknown): unknown[] => {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!root) {return [];}
  const candidates: unknown[] = [root.data, root];
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null;
  if (data) {
    if (typeof data.dataString === 'string') {
      try {
        candidates.unshift(JSON.parse(data.dataString));
      } catch {
        // not JSON — fall through to the map itself
      }
    }
    candidates.push(data.data);
  }
  return candidates.filter((c) => c && typeof c === 'object');
};

export const sealedPushDataOf = (payload: unknown): Record<string, unknown> | null =>
  (pushDataCandidates(payload).find((candidate) =>
    sealedPushEnvelopeOf(candidate as Record<string, unknown>)
  ) as Record<string, unknown> | undefined) ?? null;

/** The call fields of an incoming-call push in the task payload, if it is one. */
export const callPushDataOf = (payload: unknown): Record<string, unknown> | null =>
  (pushDataCandidates(payload).find((candidate) =>
    isCallPush(candidate as Record<string, unknown>)
  ) as Record<string, unknown> | undefined) ?? null;

const notificationContent = (result: OpenSealedPushResult, options: SealedPushTaskOptions) => {
  const { envelope } = result;
  // What the tap handler (`handlePushPayload` through the host's response
  // listener) needs: the same ids a plain push carries on `data`.
  const reaction = isReactionPush(envelope);
  const data = {
    jid: envelope.jid,
    msgID: envelope.msgID,
    userJid: envelope.userJid,
    sealed: true,
    ...(reaction ? { type: 'reaction' } : {}),
  };
  const sound = reaction ? false : 'default';
  if (!result.ok) {
    return {
      title: options.placeholderTitle || (reaction ? PLACEHOLDER_REACTION_TITLE : PLACEHOLDER_TITLE),
      ...(options.placeholderBody ? { body: options.placeholderBody } : {}),
      data,
      sound,
    };
  }
  const { content } = result;
  return {
    title: content.title || content.sender || content.chat || PLACEHOLDER_TITLE,
    body: content.body,
    data: { ...data, chatJid: content.chatJid, senderJid: content.senderJid },
    sound,
  };
};

/**
 * Open a sealed push and show it. One notification per chat: the room JID
 * is the identifier, so a newer message replaces the older one the way the
 * service's collapse key does for plain pushes. A reaction has its own
 * identifier per chat (and its own channel), so it never replaces the
 * chat's new-message notification.
 */
export async function presentSealedPush(
  data: Record<string, unknown>,
  options: SealedPushTaskOptions = {}
): Promise<OpenSealedPushResult | null> {
  const envelope = sealedPushEnvelopeOf(data);
  if (!envelope) {return null;}
  const notifications = loadNotifications();
  if (!notifications?.scheduleNotificationAsync) {return null;}

  const result = openSealedPush(envelope, await loadPushSecretKey());
  // console, not only pushLog: with the app killed this runs headless and
  // `adb logcat -s ReactNativeJS` is the only place to see it.
  if (result.ok) {
    console.log(`[push] sealed push kid=${envelope.kid} opened for ${envelope.jid}`);
  } else {
    console.warn(`[push] sealed push kid=${envelope.kid} not opened (${result.reason}), showing the placeholder`);
    pushLog('warn', `push: sealed push not opened (${result.reason}), showing the placeholder`);
  }
  const reaction = isReactionPush(envelope);
  const base = envelope.jid || envelope.msgID || '';
  const identifier = base ? (reaction ? `${base}#reaction` : base) : undefined;
  const channelId = (reaction && options.reactionChannelId) || options.channelId;
  const content = notificationContent(result, options);
  await notifications.scheduleNotificationAsync({
    identifier,
    content,
    trigger: channelId ? { channelId } : null,
  });
  if (result.ok && result.content.image && identifier && options.onMessageShown) {
    try {
      await options.onMessageShown({
        identifier,
        channelId,
        title: content.title,
        body: content.body ?? '',
        sender: result.content.sender,
        senderJid: result.content.senderJid,
        chat: result.content.chat,
        chatJid: result.content.chatJid,
        image: result.content.image,
        reaction,
      });
    } catch (e) {
      pushLog('warn', 'push: drawing the sender avatar failed', e);
    }
  }
  return result;
}

/**
 * Define and register the background task that renders sealed pushes on
 * Android. Call it at module scope of a file the app loads first (the
 * entry file, or the root layout with expo-router): a killed app is
 * started headless to run it, and the task must exist by then. No-op on
 * iOS and when expo-task-manager / expo-notifications are not installed.
 */
export function registerSealedPushTask(options: SealedPushTaskOptions = {}): boolean {
  if (Platform.OS !== 'android' || registered) {return registered;}
  const taskManager = loadTaskManager();
  const notifications = loadNotifications();
  if (!taskManager?.defineTask || !notifications?.registerTaskAsync) {
    pushLog(
      'warn',
      'push: expo-task-manager and expo-notifications are needed to show encrypted pushes on Android'
    );
    return false;
  }
  taskManager.defineTask(SEALED_PUSH_TASK, async ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) {return;}
    const call = callPushDataOf(data);
    if (call) {
      if (AppState.currentState === 'active' || !options.onCallPush) {return;}
      try {
        console.log(`[push] incoming call push ${String(call.callId ?? '')}`);
        await options.onCallPush(call);
      } catch (e) {
        pushLog('warn', 'push: showing an incoming call failed', e);
      }
      return;
    }
    const map = sealedPushDataOf(data);
    if (!map) {return;}
    // In the foreground the room is live over XMPP; the host's
    // notification handler decides about plain pushes there too.
    if (AppState.currentState === 'active') {return;}
    try {
      await presentSealedPush(map, options);
    } catch (e) {
      pushLog('warn', 'push: showing a sealed push failed', e);
    }
  });
  registered = true;
  notifications.registerTaskAsync(SEALED_PUSH_TASK).catch((e: unknown) => {
    registered = false;
    pushLog('warn', 'push: registering the sealed push task failed', e);
  });
  return true;
}

/** Test seam only. */
export const __resetSealedPushTaskForTests = (): void => {
  registered = false;
};
