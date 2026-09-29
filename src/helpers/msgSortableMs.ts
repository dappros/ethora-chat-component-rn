// Count messages strictly newer than a given millisecond timestamp using
// `msg.id` (the server-authoritative microsecond timestamp prefixed by a
// 13-digit millis, see `helpers/dateComparison`'s
// `getHighResolutionTimestamp`) rather than `msg.date`, which can be
// derived client-side (`createMessageFromXml` falls back to `Date.now()`
// for realtime stanzas without a `date` attr) and drift from what the
// server actually assigned.
//
// Extracted to its own module (rather than living in roomsSlice.ts, its
// original home) so helpers that need the SAME ordering source - notably
// `insertMessageWithDelimiter.ts`, which decides where the "New messages"
// divider sits - can import it without creating a roomStore <-> helpers
// import cycle (roomsSlice.ts already imports insertMessageWithDelimiter).
// roomsSlice.ts re-exports this for backward compatibility with existing
// call sites.
export const msgSortableMs = (msg: any): number => {
  const id = String(msg?.id || '');
  const m = /^(\d{13})/.exec(id);
  if (m) {return Number(m[1]);}
  if (msg?.date) {
    const t = new Date(msg.date as any).getTime();
    if (Number.isFinite(t)) {return t;}
  }
  return 0;
};
