import type { Middleware } from '@reduxjs/toolkit';
import { setBlockedUserIds } from '../chatSettingsSlice';
import { blockedIdOf, isUserBlockEnabled } from '../../helpers/userBlock';

let lastHydratedKey = '';

const tryHydrate = (storeAPI: { getState: () => any; dispatch: (action: any) => any }): void => {
  const settings = storeAPI.getState()?.chatSettingStore;
  if (!isUserBlockEnabled(settings?.config)) {return;}

  const token = settings?.user?.token || '';
  const xmppUsername = settings?.user?.xmppUsername || '';
  if (!token || !xmppUsername) {return;}

  const key = `${xmppUsername}|${token}`;
  if (key === lastHydratedKey) {return;}
  lastHydratedKey = key;

  const { getBlockedUsers } = require('../../networking/api-requests/rooms.api');
  Promise.resolve(getBlockedUsers())
    .then((list: { xmppUsername?: string }[]) => {
      storeAPI.dispatch(setBlockedUserIds(list.map((u) => blockedIdOf(u.xmppUsername)).filter(Boolean)));
    })
    .catch((error: unknown) => {
      // Flag on but the route is missing or failed: keep the list as it is
      console.warn('[ethora-rn] blocked users not loaded', error);
      lastHydratedKey = '';
    });
};

export const blockedHydrationMiddleware: Middleware = (storeAPI) => (next) => (action: any) => {
  const result = next(action);

  if (action?.type === 'chat/logout') {
    lastHydratedKey = '';
  } else if (action?.type === 'chat/setUser' || action?.type === 'chat/setConfig') {
    tryHydrate(storeAPI);
  }

  return result;
};
