import { isOwnMessage } from './isOwnMessage';
import type { IMessage } from '../types/types';

/**
 * Who decides whether an incoming live message raises an in-app toast.
 * Same rules as the web client's notificationPolicy, plus the room-level
 * one RN shows: a toast is for a message in ANOTHER chat, from SOMEONE
 * ELSE, while the app is on screen.
 */

/** `Room@Conference.Host/nick` → `room@conference.host`. */
export const bareJid = (jid: unknown): string =>
  String(jid ?? '').split('/')[0].trim().toLowerCase();

/** `user@host/res` → `user`; a bare id stays as it is. Lowercased. */
const localPart = (id: unknown): string =>
  String(id ?? '').split('/')[0].split('@')[0].trim().toLowerCase();

export interface CurrentUserIds {
  xmppUsername?: string | null;
  walletAddress?: string | null;
  id?: string | null;
}

/**
 * The reader's own message, coming back from the room. Any one of these is
 * enough, because each sender path fills a different one:
 *   • the MUC nickname (the occupant resource of the stanza's `from`),
 *     which is the sender's XMPP local part;
 *   • the `senderJID` the sender put in `<data>`;
 *   • the parsed message's user id (what the bubble's own/other side uses).
 * The old check only looked for the wallet address inside `senderJID`, so
 * an account whose XMPP name is not its wallet got toasts for its own
 * messages.
 */
export const isOwnIncomingMessage = ({
  message,
  stanzaFrom,
  senderJID,
  user,
}: {
  message: Pick<IMessage, 'user'> | null | undefined;
  stanzaFrom?: string | null;
  senderJID?: string | null;
  user: CurrentUserIds | null | undefined;
}): boolean => {
  const mine = [user?.xmppUsername, user?.walletAddress]
    .map(localPart)
    .filter(Boolean);
  if (!mine.length) {return false;}
  const nickname = String(stanzaFrom ?? '').split('/')[1];
  const candidates = [nickname, senderJID].map(localPart).filter(Boolean);
  if (candidates.some((id) => mine.includes(id))) {return true;}
  return isOwnMessage(message, user ?? undefined);
};

/**
 * Whether a toast for a message in `roomJID` should show right now. Read
 * at the moment the message arrives (not from a render closure).
 */
export const shouldToastForRoom = ({
  roomJID,
  visibleRoomJID,
  appActive,
  muted,
}: {
  roomJID: string;
  visibleRoomJID?: string | null;
  appActive: boolean;
  muted?: boolean;
}): boolean => {
  // Off screen: the OS push is the channel; a banner would only pop up,
  // stale, when the user comes back.
  if (!appActive) {return false;}
  // The user is reading that chat: the message is already on screen.
  if (visibleRoomJID && bareJid(visibleRoomJID) === bareJid(roomJID)) {
    return false;
  }
  // Notifications for that chat are off.
  if (muted) {return false;}
  return true;
};
