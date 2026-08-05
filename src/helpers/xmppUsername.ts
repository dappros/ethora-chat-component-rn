import { store } from '../roomStore';

/**
 * Collapse a duplicated `<appId>_` prefix down to one.
 *
 * Ported from the web SDK (src/helpers/xmppUsername.ts). Some senders stamp
 * an already-qualified username and it gets qualified a second time, which
 * yields `<appId>_<appId>_<userId>` — a key `usersSet` will never match.
 *
 * RN reads the appId off the logged-in user's own xmppUsername
 * (`<appId>_<userId>`) since the chat store has no standalone `appId` field
 * the way web's does.
 */
export const normalizeXmppUsername = (
  value: string | undefined | null
): string => {
  if (!value) {
    return '';
  }
  let result = String(value).trim();
  if (!result) {
    return '';
  }

  const ownXmpp = String(
    store.getState().chatSettingStore?.user?.xmppUsername || ''
  );
  const appId = ownXmpp.includes('_') ? ownXmpp.split('_')[0] : '';
  if (!appId) {
    return result;
  }

  const prefix = `${appId}_`;
  while (result.startsWith(prefix + prefix)) {
    result = result.slice(prefix.length);
  }
  return result;
};
