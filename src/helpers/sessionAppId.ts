import { store } from '../roomStore';

/**
 * The appId of the current session. RN's chat store has no standalone
 * `appId` field the way web's does, so it is read from the signed-in user
 * (`user.appId`), then the host config (`config.appId`), then the prefix of
 * the user's own `<appId>_<userId>` xmppUsername. Empty when unknown.
 */
export const getSessionAppId = (): string => {
  const state = store.getState().chatSettingStore as any;
  const fromUser = String(state?.user?.appId || '').trim();
  if (fromUser) return fromUser;
  const fromConfig = String(state?.config?.appId || '').trim();
  if (fromConfig) return fromConfig;
  const own = String(state?.user?.xmppUsername || '');
  return own.includes('_') ? own.split('_')[0] : '';
};
