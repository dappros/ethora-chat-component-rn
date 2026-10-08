import { useChatSettingState } from './useChatSettingState';
import { useT } from '../i18n/useT';

/**
 * What the headers say in place of their usual title while the session is
 * not usable yet: "Connecting…" until the stream is up (first connect and
 * every reconnect), "Updating…" while rooms are re-joined and the archive
 * caught up. Nothing once the chat is live.
 */
export const useConnectionLabel = (): string | undefined => {
  const { connection } = useChatSettingState();
  const t = useT();
  if (connection === 'connecting') {return t('connection.connecting');}
  if (connection === 'syncing') {return t('connection.updating');}
  return undefined;
};
