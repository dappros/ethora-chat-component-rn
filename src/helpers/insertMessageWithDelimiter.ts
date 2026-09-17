import { IMessage } from '../types/types';
import { isDateAfter, isDateBefore } from './dateComparison';
import { msgSortableMs } from './msgSortableMs';

// Robustly resolve a caller-supplied read marker to epoch milliseconds.
// Callers pass a plain number (the redux read boundary, or a room's
// lastViewedTimestamp), a Date object (older call sites), or occasionally
// a numeric string. These are NOT interchangeable through the Date
// constructor: `new Date(1757000000123)` (a number) reads as epoch-ms,
// but `new Date("1757000000123")` (a string) is parsed as a date STRING
// - a bare 13-digit string matches no recognized date format, so the
// result is silently Invalid Date and every comparison against it is
// `false`. Try Number() first so a numeric string/number is read as
// epoch-ms; only fall through to Date parsing for genuine date/ISO
// strings (e.g. a Date object's own `.toString()`). Never falls back to
// `Date.now()` - a marker we can't resolve is treated as "no marker",
// not "now" (bug #38).
function resolveMarkerMs(
  marker: number | { toString: () => string } | null | undefined
): number {
  if (marker == null) {return 0;}
  if (typeof marker === 'number') {
    return Number.isFinite(marker) ? marker : 0;
  }
  const raw = marker.toString();
  if (raw.trim() !== '') {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {return asNumber;}
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deepMerge(target: any, source: any): any {
  for (const key in source) {
    if (source[key] === undefined) {
      // `for...in` visits a key even when its value is `undefined` — every
      // stanza parser (getDataFromXml/createMessageFromXml) returns an
      // object literal with `translations` always present, explicitly
      // `undefined` whenever the wire message didn't carry a
      // <translations> element. Without this guard, merging THAT message
      // over an existing row would blow away a translation the row
      // already had (e.g. a MAM/live echo of a message arriving without
      // its translation re-attached) — a real message flips from
      // translated back to original text for no reason. Absence on the
      // incoming side must mean "leave it alone", never "clear it".
      continue;
    }
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
  lastViewedTimestamp: number | { toString: () => string } | null,
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

    const lastViewedMs = resolveMarkerMs(lastViewedTimestamp);
    const newMessageMs = msgSortableMs(message);
    if (
      lastViewedMs > 0 &&
      newMessageMs > lastViewedMs &&
      !roomMessages.some((msg) => msg.id === 'delimiter-new')
    ) {
      // Find the first message STRICTLY newer than the marker, using the
      // SAME timestamp source (msgSortableMs - the server id-encoded ms)
      // as the unread middleware and countNewerMessages use to decide
      // what counts as unread. Comparing against a DIFFERENT source (the
      // old code compared `msg.date` strings) risks the boundary message
      // itself landing on the wrong side of the cut: since bug #38 the
      // marker can equal a real message's own timestamp exactly, and any
      // drift between `date` and the id-encoded ms - or a raw numeric
      // marker silently producing an Invalid Date via the Date
      // constructor's string-parsing path - could count that message as
      // unread, pushing the divider one message too early (ABOVE the
      // last read message instead of directly below it). Customer #42.
      const delimiterIndex = roomMessages.findIndex(
        (msg) => msg.id !== 'delimiter-new' && msgSortableMs(msg) > lastViewedMs
      );

      if (delimiterIndex !== -1) {
        // The divider's date is what ORDERS it: roomsSlice re-sorts every
        // merged page by timestamp (see `byMs`), so a divider stamped with
        // `new Date()` (i.e. now) sorted past every real message and
        // rendered at the very bottom, BELOW the new messages it is
        // supposed to introduce. Anchor it a hair before the first unread
        // instead, which is where it belongs and where any later sort keeps
        // it.
        const firstUnreadMs = msgSortableMs(roomMessages[delimiterIndex]);
        const anchorMs = firstUnreadMs > 0 ? firstUnreadMs - 1 : lastViewedMs;

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
