import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../roomStore';
import {
  clearPendingNotificationJid,
  setCurrentRoom,
  setPendingNotificationJid,
} from '../roomStore/roomsSlice';
import { handleCallPush } from './incomingCallFromPush';
import { normalizeRoomJid } from './normalizeRoomJid';

export type PushPayloadOutcome = 'call' | 'room' | 'pending' | 'unknown';

export const PENDING_NOTIFICATION_JID_KEY = 'ethora_pending_notification_jid';
export const PENDING_NOTIFICATION_TTL_MS = 5 * 60 * 1000;

export const readPendingJid = async (): Promise<string | null> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_NOTIFICATION_JID_KEY);
    if (!raw) {return null;}
    if (raw.startsWith('{')) {
      const { jid, at } = JSON.parse(raw) as { jid?: string; at?: number };
      if (!jid || !at || Date.now() - at > PENDING_NOTIFICATION_TTL_MS) {
        await AsyncStorage.removeItem(PENDING_NOTIFICATION_JID_KEY);
        return null;
      }
      return jid;
    }
    return raw;
  } catch {
    return null;
  }
};

export const openRoomFromPush = (jid: string): 'room' | 'pending' => {
  const state = store.getState();
  const conference = state.chatSettingStore?.config?.xmppSettings?.conference;
  const full = normalizeRoomJid(jid, conference);

  AsyncStorage.setItem(
    PENDING_NOTIFICATION_JID_KEY,
    JSON.stringify({ jid: full, at: Date.now() })
  ).catch(() => undefined);
  if (state.rooms?.rooms?.[full]) {
    store.dispatch(clearPendingNotificationJid());
    store.dispatch(setCurrentRoom({ roomJID: full }));
    return 'room';
  }
  store.dispatch(setPendingNotificationJid(full));
  return 'pending';
};

export const handlePushPayload = (
  data: Record<string, unknown> | null | undefined
): PushPayloadOutcome => {
  if (!data) {return 'unknown';}
  if (handleCallPush(data as Record<string, any>)) {return 'call';}
  const jid = data.jid ?? data.chatJid ?? data.roomJid ?? data.roomJID;
  if (typeof jid === 'string' && jid) {
    return openRoomFromPush(jid);
  }
  return 'unknown';
};
