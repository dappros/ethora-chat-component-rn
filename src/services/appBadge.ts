// The app icon badge, kept honest from the device side.
//
// The backend sets the badge only on the push it sends, so nothing lowers it
// once the user reads the messages: opening the app would keep showing the
// count of the last push. While the app is in the foreground the badge
// follows the total unread count instead - 0 when everything is read, the
// real number otherwise - and the server takes over again with its next push.
//
// Needs expo-notifications (an optional peer); without it this is a no-op.
// Hosts that drive the badge themselves set
// `config.pushNotifications.syncAppBadge: false`.

import { AppState } from 'react-native';
import { store } from '../roomStore';
import type { IRoom } from '../types/types';
import { pushLog } from '../utils/devLogger';

let installed = false;
let lastSet: number | null = null;
let lastRooms: unknown;

const loadNotifications = (): any => {
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
};

const totalUnread = (): number =>
  Object.values(store.getState().rooms?.rooms || {}).reduce(
    (sum, room: IRoom) => sum + (room?.unreadMessages || 0),
    0
  );

const isEnabled = (): boolean =>
  store.getState().chatSettingStore?.config?.pushNotifications?.syncAppBadge !==
  false;

const sync = (): void => {
  if (AppState.currentState !== 'active' || !isEnabled()) {
    return;
  }
  const count = totalUnread();
  if (count === lastSet) {
    return;
  }
  const notifications = loadNotifications();
  if (typeof notifications?.setBadgeCountAsync !== 'function') {
    return;
  }
  lastSet = count;
  Promise.resolve(notifications.setBadgeCountAsync(count)).catch((error: unknown) => {
    lastSet = null;
    pushLog('warn', 'push: setting the app badge failed', error);
  });
};

export const installAppBadgeSync = (): void => {
  if (installed) {
    return;
  }
  installed = true;
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      // A push may have moved the badge while we were away.
      lastSet = null;
      sync();
    }
  });
  // Only actions that touch the rooms can move the count.
  store.subscribe(() => {
    const rooms = store.getState().rooms?.rooms;
    if (rooms !== lastRooms) {
      lastRooms = rooms;
      sync();
    }
  });
  sync();
};

export const __resetAppBadgeForTests = (): void => {
  lastSet = null;
  lastRooms = undefined;
};
