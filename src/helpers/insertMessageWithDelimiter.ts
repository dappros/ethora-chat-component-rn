import { IMessage } from '../types/types';
import { isDateAfter, isDateBefore } from './dateComparison';

function deepMerge(target: any, source: any): any {
  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export function insertMessageWithDelimiter(
  roomMessages: Partial<IMessage>[],
  message: IMessage,
  lastViewedTimestamp: { toString: () => string } | null,
) {
  const existingIndex = roomMessages.findIndex(
    (msg) =>
      msg.id === message.id ||
      (message.xmppId && msg.id === message.xmppId) ||
      (msg.xmppId && msg.xmppId === message.id)
  );

  if (existingIndex !== -1) {
    const existing = roomMessages[existingIndex];
    // Preserve the sender identity captured on first insert. The MUC echo
    // parses user.id from the stanza's `from`/senderJID (the room nick or
    // bare-jid local part), which often differs from the optimistic
    // sender id (xmppUsername / walletAddress) set when WE sent it.
    // deepMerge would overwrite it, flipping an own message to the "other"
    // side (rendered on the left, "as if someone else wrote it"). Keep the
    // original id so ownership (user.id === self) stays correct.
    const preservedUserId =
      (existing as any)?.user?.id || (message as any)?.user?.id;
    const merged = deepMerge({ ...existing }, { ...message, pending: false });
    if (merged.user && preservedUserId) {
      merged.user.id = preservedUserId;
    }
    roomMessages[existingIndex] = merged;
    return;
  }

  const newMessageDate = message.date;
  const lastMessage = roomMessages[roomMessages.length - 1];
  const firstMessage = roomMessages[0];

  if (isDateAfter(newMessageDate.toString(), lastMessage?.date?.toString() ?? '')) {
    const index = roomMessages.findIndex(
      (msg) => msg.id === message.xmppId || msg.id === message.id
    );

    if (index !== -1) {
      roomMessages[index] = { ...message, id: message.id, pending: false };
    } else {
      roomMessages.push(message);
    }

    if (
      lastViewedTimestamp &&
      !roomMessages.some((msg) => msg.id === 'delimiter-new') &&
      isDateAfter(newMessageDate.toString(), lastViewedTimestamp.toString())
    ) {
      const delimiterIndex = roomMessages.findIndex((msg) =>
        isDateAfter(msg.date?.toString() ?? '', lastViewedTimestamp.toString())
      );

      if (delimiterIndex !== -1) {
        // The divider's date is what ORDERS it: roomsSlice re-sorts every
        // merged page by timestamp (see `byMs`), so a divider stamped with
        // `new Date()` — i.e. now — sorted past every real message and
        // rendered at the very bottom, BELOW the new messages it is
        // supposed to introduce. Anchor it a hair before the first unread
        // instead, which is where it belongs and where any later sort keeps
        // it. Derived from that message rather than from
        // lastViewedTimestamp so it works whatever format the caller passes.
        const firstUnreadMs = Date.parse(
          String(roomMessages[delimiterIndex]?.date ?? '')
        );
        const rawLastViewed = lastViewedTimestamp.toString();
        const lastViewedMs =
          Date.parse(rawLastViewed) || Number(rawLastViewed) || Date.now();
        const anchorMs = Number.isFinite(firstUnreadMs)
          ? firstUnreadMs - 1
          : lastViewedMs;

        roomMessages.splice(delimiterIndex, 0, {
          id: 'delimiter-new',
          user: {
            id: 'system',
            name: undefined,
            token: '',
            refreshToken: '',
          },
          date: new Date(anchorMs).toISOString(),
          body: 'New Messages',
          roomJid: '',
        });
      }
      }
  } else if (
    isDateBefore(newMessageDate.toString(), firstMessage?.date?.toString() ?? '')
  ) {
    roomMessages.unshift(message);
  } else {
    for (let i = 0; i < roomMessages.length; i++) {
      if (
        isDateBefore(newMessageDate.toString(), roomMessages[i].date?.toString() ?? '')
      ) {
        roomMessages.splice(i, 0, message);
        break;
      }
    }
  }
}
