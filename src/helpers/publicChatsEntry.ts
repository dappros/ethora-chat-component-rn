import type { IConfig } from '../types/types';

/**
 * "Discover chats" lives in the room list menu sheet. A host that takes the
 * burger over (`headerMenu` as a function) would otherwise have no obvious
 * way to reach the directory, so it also gets a button of its own in the
 * room list header. `chatHeaderSettings.disableMenu` does not count: the
 * header avatar still opens the sheet, Discover included, and a second
 * compass next to it was a duplicate. `disableRoomMenu` removes the menu
 * entry point, and with it the button; `disablePublicChatsDirectory`
 * removes the feature altogether.
 */
export const showsStandaloneDiscoverButton = (config?: IConfig): boolean =>
  !config?.disablePublicChatsDirectory &&
  !config?.disableRoomMenu &&
  typeof config?.headerMenu === 'function';
