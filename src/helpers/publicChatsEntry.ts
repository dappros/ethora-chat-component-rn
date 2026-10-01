import type { IConfig } from '../types/types';

/**
 * "Discover chats" lives in the room list menu sheet. A host that takes the
 * burger over (`headerMenu` as a function) or hides the menu
 * (`chatHeaderSettings.disableMenu`) would otherwise have no obvious way to
 * reach the directory, so it also gets a button of its own in the room list
 * header. `disableRoomMenu` removes the menu entry point, and with it the
 * button; `disablePublicChatsDirectory` removes the feature altogether.
 */
export const showsStandaloneDiscoverButton = (config?: IConfig): boolean =>
  !config?.disablePublicChatsDirectory &&
  !config?.disableRoomMenu &&
  (Boolean(config?.chatHeaderSettings?.disableMenu) ||
    typeof config?.headerMenu === 'function');
