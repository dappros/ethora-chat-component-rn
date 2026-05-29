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
        roomMessages.splice(delimiterIndex, 0, {
          id: 'delimiter-new',
          user: {
            id: 'system',
            name: undefined,
            token: '',
            refreshToken: '',
          },
          date: new Date().toString(),
          body: 'New Messages',
          roomJid: '',
        });

        if (lastViewedTimestamp.toString() === '0') {
          roomMessages.splice(delimiterIndex, 1);
        }
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
