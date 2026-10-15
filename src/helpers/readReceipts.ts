import type { IMessage, IRoom } from '../types/types';
import { msgSortableMs } from './msgSortableMs';
import { isOwnMessage } from './isOwnMessage';
import { createUserNameFromSetUser } from './createUserNameFromSetUser';

// Delivery (XEP-0184) and read (XEP-0333) state for the reader's own messages.
// Pure helpers: the reducers, the stanza handlers, the flush that sends the
// read watermark and the bubble all read the same rules from here.
//
// Receipts are session-only. receivedBy / lastDisplayedByUser are never
// written to disk (see persistence.ts), so after a reload every own message
// falls back to "sent" until the peers acknowledge again.

export type ReceiptStatus = 'sent' | 'delivered' | 'seen';

/** Names listed in a "Read by" / "Delivered to" sheet before the rest become "+N". */
export const RECEIPT_NAME_LIMIT = 5;

const NO_VIEWERS: string[] = [];

/** Stanza ids of the receipt and marker frames (never chat messages). */
export const isReceiptMarkerId = (id: unknown): boolean => {
  const value = String(id ?? '');
  return value.startsWith('message-received') || value.startsWith('message-displayed');
};

// A message the reader can be shown as displayed: not an optimistic send,
// not the "New messages" divider, not a client-only call-log row.
const isDisplayableForReceipts = (message: IMessage | undefined | null): boolean => {
  if (!message) return false;
  if (message.pending) return false;
  if (message.id === 'delimiter-new') return false;
  if (String(message.id || '').startsWith('calllog-')) return false;
  return true;
};

/**
 * The message id that becomes this reader's read watermark, or null when
 * nothing should be sent: no displayable message, the newest message is the
 * reader's own (nothing to report), or a read boundary (the reader scrolled
 * up) sits before every message. With a boundary the watermark is the newest
 * message at or before it, so a scrolled-up reader never claims messages they
 * did not reach.
 */
export const getReadWatermarkMessageId = (
  room: Pick<IRoom, 'messages'> | null | undefined,
  selfXmppUsername: string,
  boundaryTs?: number | null
): string | null => {
  if (!selfXmppUsername) return null;
  const messages = (room?.messages || []).filter(isDisplayableForReceipts);
  if (messages.length === 0) return null;
  const newest = messages[messages.length - 1];
  if (isOwnMessage(newest, selfXmppUsername)) return null;
  if (typeof boundaryTs === 'number' && boundaryTs > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (msgSortableMs(messages[i]) <= boundaryTs) return String(messages[i].id);
    }
    return null;
  }
  return String(newest.id);
};

/** The slice of the redux state the receipt rules read. */
export interface ReceiptStoreState {
  chatSettingStore?: {
    config?: { disableLastRead?: boolean; disableReadReceipts?: boolean } | null;
    user?: { xmppUsername?: string | null; walletAddress?: string | null } | null;
  } | null;
  rooms: {
    rooms: Record<string, IRoom>;
    visibleRoomJID: string | null;
    jumpWindow: { roomJID: string } | null;
    readBoundaries: Record<string, number>;
  };
}

// The reader's identity as the message list resolves it (xmppUsername, then
// walletAddress), so the watermark and the bubble agree on "own".
export const selfIdentity = (state: ReceiptStoreState): string =>
  state.chatSettingStore?.user?.xmppUsername || state.chatSettingStore?.user?.walletAddress || '';

/**
 * Watermark to send for `roomJid` right now, or null. Sends only while the
 * room is the one on screen, never while an old-history jump window is open,
 * and never when read markers are switched off (`disableLastRead` or
 * `disableReadReceipts`).
 */
export const computeReadWatermark = (
  state: ReceiptStoreState,
  roomJid: string
): string | null => {
  if (!roomJid) return null;
  const config = state.chatSettingStore?.config;
  if (config?.disableLastRead || config?.disableReadReceipts) return null;
  const rooms = state.rooms;
  if (rooms.visibleRoomJID !== roomJid) return null;
  if (rooms.jumpWindow?.roomJID === roomJid) return null;
  return getReadWatermarkMessageId(
    rooms.rooms?.[roomJid],
    selfIdentity(state),
    rooms.readBoundaries?.[roomJid] ?? null
  );
};

/**
 * Other occupants whose read watermark sits at or after `messageId` in the
 * room's list. Returns the shared empty array when there are none, so the
 * selector result stays shallow-equal between store updates.
 */
export const viewersAtOrAfter = (
  room: Pick<IRoom, 'messages' | 'lastDisplayedByUser'> | null | undefined,
  messageId: string,
  selfXmppUsername: string
): string[] => {
  const watermark = room?.lastDisplayedByUser;
  const messages = room?.messages;
  if (!watermark || !messages || messages.length === 0 || !messageId) return NO_VIEWERS;
  const viewers = Object.keys(watermark).filter(
    (xmppUsername) => xmppUsername !== selfXmppUsername
  );
  if (viewers.length === 0) return NO_VIEWERS;
  const indexOf = (id: string): number => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].id === id) return i;
    }
    return -1;
  };
  const thisIndex = indexOf(messageId);
  if (thisIndex === -1) return NO_VIEWERS;
  const seen = viewers.filter((xmppUsername) => {
    const displayedIndex = indexOf(watermark[xmppUsername]);
    return displayedIndex !== -1 && displayedIndex >= thisIndex;
  });
  return seen.length > 0 ? seen : NO_VIEWERS;
};

/** Selector form of viewersAtOrAfter, keyed by room and message. */
export const selectSeenBy = (
  state: { rooms: { rooms: Record<string, IRoom> } },
  roomJid: string,
  messageId: string,
  selfXmppUsername: string
): string[] =>
  viewersAtOrAfter(state.rooms.rooms?.[roomJid], messageId, selfXmppUsername);

/**
 * sent / delivered / seen for one of the reader's own messages. "seen" wins
 * over "delivered", which wins over "sent". Only other occupants count.
 */
export const deliveredToOthers = (
  message: Pick<IMessage, 'receivedBy'>,
  selfXmppUsername: string
): string[] =>
  Object.keys(message.receivedBy || {}).filter(
    (xmppUsername) => xmppUsername !== selfXmppUsername
  );

export const statusOf = (seenBy: string[], deliveredTo: string[]): ReceiptStatus =>
  seenBy.length > 0 ? 'seen' : deliveredTo.length > 0 ? 'delivered' : 'sent';

export const getReceiptStatus = (
  message: Pick<IMessage, 'id' | 'receivedBy'>,
  room: Pick<IRoom, 'messages' | 'lastDisplayedByUser'> | null | undefined,
  selfXmppUsername: string
): { status: ReceiptStatus; seenBy: string[]; deliveredTo: string[] } => {
  const deliveredTo = deliveredToOthers(message, selfXmppUsername);
  const seenBy = viewersAtOrAfter(room, String(message.id), selfXmppUsername);
  return { status: statusOf(seenBy, deliveredTo), seenBy, deliveredTo };
};

/** Display name for a receipt entry: usersSet first, the raw username as the last resort. */
export const receiptNameFor = (
  usersSet: Record<string, any> | undefined,
  xmppUsername: string
): string => {
  const name = createUserNameFromSetUser(usersSet || {}, xmppUsername);
  return name && name !== 'Deleted User' ? name : xmppUsername;
};

const formatNames = (names: string[]): string => {
  const shown = names.slice(0, RECEIPT_NAME_LIMIT);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
};

/**
 * Text for the tick's details sheet. Groups name the readers or recipients
 * (capped, then "+N"); a 1:1 room only says Read / Delivered.
 */
export const describeReceipt = ({
  status,
  isGroup,
  seenBy,
  deliveredTo,
  nameOf,
  t,
}: {
  status: ReceiptStatus;
  isGroup: boolean;
  seenBy: string[];
  deliveredTo: string[];
  nameOf: (xmppUsername: string) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): string => {
  if (status === 'seen') {
    return isGroup
      ? t('message.receipt.readBy', { names: formatNames(seenBy.map(nameOf)) })
      : t('message.receipt.read');
  }
  if (status === 'delivered') {
    return isGroup
      ? t('message.receipt.deliveredTo', {
          names: formatNames(deliveredTo.map(nameOf)),
        })
      : t('message.receipt.delivered');
  }
  return t('message.receipt.sent');
};
