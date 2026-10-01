import type { PublicChat } from '../../../networking/api-requests/publicChats.api';
import { normalizeRoomJid } from '../../../helpers/normalizeRoomJid';

/**
 * The directory API has no search parameter (q, search and title are all
 * rejected), so the filter box narrows what has loaded so far.
 */
export const filterPublicChats = (
  items: PublicChat[],
  filter: string
): PublicChat[] => {
  const needle = filter.trim().toLowerCase();
  if (!needle) {return items;}
  return items.filter(
    (chat) =>
      chat.title.toLowerCase().includes(needle) ||
      chat.description.toLowerCase().includes(needle)
  );
};

/**
 * The JID to select to join a directory chat. Without a conference domain
 * there is no correct JID to build (the same rule chatAutoEnterer follows for
 * a shared link), so there is nothing to open.
 */
export const publicChatJid = (
  chat: Pick<PublicChat, 'name'>,
  conference?: string
): string | undefined => {
  const domain = (conference || '').trim();
  if (!domain || !chat.name) {return undefined;}
  return normalizeRoomJid(chat.name, domain);
};

export const initialOf = (chat: Pick<PublicChat, 'title' | 'name'>): string =>
  (chat.title || chat.name).trim().charAt(0).toUpperCase() || '#';
