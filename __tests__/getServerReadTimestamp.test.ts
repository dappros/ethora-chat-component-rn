/**
 * getServerReadTimestamp - resolves a "read up to here" marker from
 * SERVER time (never Date.now()), so a device with a fast clock can
 * never write a future marker that permanently blocks later corrections
 * (bug #38).
 */

import {
  getServerReadTimestamp,
  getReadMarkerTimestamp,
  getFlushBoundaryTs,
} from '../src/helpers/getServerReadTimestamp';
import type { IMessage, IRoom } from '../src/types/types';

function makeRoom(overrides: Partial<IRoom> = {}): IRoom {
  return {
    id: 'r@h',
    name: 'room',
    jid: 'r@h',
    title: 'room',
    usersCnt: 1,
    messages: [],
    isLoading: false,
    roomBg: '',
    ...overrides,
  } as IRoom;
}

// Server-assigned ids encode the server timestamp as a 13-digit ms
// prefix (see msgSortableMs / createMessageFromXml). Use that shape so
// the test exercises the same extraction the real pipeline uses.
function serverMsg(tsMs: number, id = `${tsMs}-abc`): IMessage {
  return {
    id,
    user: { id: 'u', name: 'user' } as any,
    date: new Date(tsMs).toISOString(),
    body: 'hi',
    roomJid: 'r@h',
  };
}

// Optimistic/pending messages get a non-numeric id prefix (e.g.
// `send-text-message-<Date.now()>-<seq>`) and fall back to `date`, which
// is the DEVICE clock at send time - exactly what must be excluded.
function pendingMsg(deviceTsMs: number, id: string): IMessage {
  return {
    id,
    user: { id: 'u', name: 'user' } as any,
    date: new Date(deviceTsMs).toISOString(),
    body: 'hi',
    roomJid: 'r@h',
    pending: true,
  };
}

describe('getServerReadTimestamp', () => {
  it('returns 0 for a null/undefined room', () => {
    expect(getServerReadTimestamp(null)).toBe(0);
    expect(getServerReadTimestamp(undefined)).toBe(0);
  });

  it('returns 0 when the room has no messages and no prior marker', () => {
    const room = makeRoom({ messages: [] });
    expect(getServerReadTimestamp(room)).toBe(0);
  });

  it('falls back to the existing lastViewedTimestamp when there are no messages', () => {
    const room = makeRoom({ messages: [], lastViewedTimestamp: 1_700_000_000_000 });
    expect(getServerReadTimestamp(room)).toBe(1_700_000_000_000);
  });

  it('returns the newest server-acknowledged message timestamp', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000),
        serverMsg(1_700_000_050_000),
        serverMsg(1_700_000_010_000),
      ],
    });
    expect(getServerReadTimestamp(room)).toBe(1_700_000_050_000);
  });

  it('ignores a pending (optimistic) message even if its device date is newer', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000),
        // Device clock is far ahead - this must NOT win.
        pendingMsg(1_700_999_000_000, 'send-text-message-1700999000000-1'),
      ],
    });
    expect(getServerReadTimestamp(room)).toBe(1_700_000_000_000);
  });

  it('ignores a message queued in the retry heap even without a pending flag', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000),
        {
          id: 'heap-1',
          user: { id: 'u', name: 'user' } as any,
          date: new Date(1_700_999_000_000).toISOString(),
          body: 'media',
          roomJid: 'r@h',
        } as IMessage,
      ],
    });
    const heapState = {
      messageHeap: [{ id: 'heap-1' } as IMessage],
      failedMessages: {},
    };
    expect(getServerReadTimestamp(room, heapState)).toBe(1_700_000_000_000);
  });

  it('ignores a failed-send message id', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000),
        {
          id: 'failed-1',
          user: { id: 'u', name: 'user' } as any,
          date: new Date(1_700_999_000_000).toISOString(),
          body: 'oops',
          roomJid: 'r@h',
        } as IMessage,
      ],
    });
    const heapState = {
      messageHeap: [],
      failedMessages: { 'failed-1': {} },
    };
    expect(getServerReadTimestamp(room, heapState)).toBe(1_700_000_000_000);
  });

  it('ignores the transient "New messages" delimiter', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000),
        {
          id: 'delimiter-new',
          user: { id: 'system', name: undefined } as any,
          date: new Date(1_700_999_000_000).toISOString(),
          body: 'New Messages',
          roomJid: 'r@h',
        } as IMessage,
      ],
    });
    expect(getServerReadTimestamp(room)).toBe(1_700_000_000_000);
  });

  it('prefers the newest acked message over an older existing lastViewedTimestamp', () => {
    const room = makeRoom({
      messages: [serverMsg(1_700_000_050_000)],
      lastViewedTimestamp: 1_700_000_000_000,
    });
    expect(getServerReadTimestamp(room)).toBe(1_700_000_050_000);
  });

  it('falls back to lastViewedTimestamp when every message is pending/heap/failed', () => {
    const room = makeRoom({
      messages: [pendingMsg(1_700_999_000_000, 'send-text-message-x-1')],
      lastViewedTimestamp: 1_700_000_000_000,
    });
    expect(getServerReadTimestamp(room)).toBe(1_700_000_000_000);
  });
});

/**
 * getReadMarkerTimestamp - the boundary-aware wrapper introduced for bug
 * #42 (a regression of #33 reintroduced by #38). Every path that stamps
 * a "leaving this room" read marker must go through this instead of
 * getServerReadTimestamp directly, so leaving a room while scrolled up
 * doesn't stamp "everything read".
 */
describe('getReadMarkerTimestamp', () => {
  it('matches getServerReadTimestamp when no boundary is given', () => {
    const room = makeRoom({
      messages: [serverMsg(1_700_000_000_000), serverMsg(1_700_000_050_000)],
    });
    expect(getReadMarkerTimestamp(room)).toBe(1_700_000_050_000);
    expect(getReadMarkerTimestamp(room, null, null)).toBe(1_700_000_050_000);
    expect(getReadMarkerTimestamp(room, null, undefined)).toBe(1_700_000_050_000);
  });

  it('matches getServerReadTimestamp when the boundary is 0 or negative (treated as unset)', () => {
    const room = makeRoom({
      messages: [serverMsg(1_700_000_000_000), serverMsg(1_700_000_050_000)],
    });
    expect(getReadMarkerTimestamp(room, null, 0)).toBe(1_700_000_050_000);
    expect(getReadMarkerTimestamp(room, null, -1)).toBe(1_700_000_050_000);
  });

  it('uses the boundary (the newest message the user actually reached) instead of the newest acked message when the user is scrolled up', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000), // last message the user reached
        serverMsg(1_700_000_010_000), // received while scrolled up - unread
        serverMsg(1_700_000_020_000), // received while scrolled up - unread
      ],
    });
    // Without a boundary this would be 1_700_000_020_000 (newest) - which
    // is exactly bug #42: it would mark the two unread messages as read.
    expect(getReadMarkerTimestamp(room, null, 1_700_000_000_000)).toBe(
      1_700_000_000_000
    );
  });

  it('clamps the boundary so it can never exceed the newest server-acked message', () => {
    const room = makeRoom({
      messages: [serverMsg(1_700_000_000_000)],
    });
    // A stale/corrupt boundary further ahead than anything this room
    // actually has must not be trusted outright.
    expect(getReadMarkerTimestamp(room, null, 1_700_000_999_000)).toBe(
      1_700_000_000_000
    );
  });

  it('returns 0 (skip the write) when there is no known acked message to clamp the boundary against', () => {
    // A brand new / not-yet-synced room. The boundary can only have come
    // from the rendered list, which here holds nothing server-acked - so
    // trusting it would smuggle a device-clock value into the marker,
    // which is exactly what bug #38 forbids. 0 means "nothing to anchor
    // to, skip the write".
    const room = makeRoom({ messages: [] });
    expect(getReadMarkerTimestamp(room, null, 1_700_000_000_000)).toBe(0);
  });

  it('never falls back to Date.now() - an unresolvable room + boundary returns 0', () => {
    expect(getReadMarkerTimestamp(null, null, null)).toBe(0);
    expect(getReadMarkerTimestamp(undefined, null, 0)).toBe(0);
    // Even with a boundary: no acked message, nothing to anchor to.
    expect(getReadMarkerTimestamp(null, null, 1_700_000_000_000)).toBe(0);
  });

  it('a pending own message can never push the boundary into the future', () => {
    // The room has ONLY a pending send (device clock, far ahead). The
    // boundary MessageList derives from the rendered list would carry
    // that device timestamp - it must not become the marker.
    const room = makeRoom({
      messages: [pendingMsg(1_700_999_000_000, 'send-text-message-1-1')],
    });
    expect(getReadMarkerTimestamp(room, null, 1_700_999_000_000)).toBe(0);
  });
});

/**
 * getFlushBoundaryTs - what the SERVER write gets. Must go through the
 * same clamp as the local stamp: the private-store merge is forward-only,
 * so an unclamped future value written there is permanent (bug #38).
 */
describe('getFlushBoundaryTs', () => {
  it('is undefined when no boundary applies, so the flush uses its own default', () => {
    const room = makeRoom({ messages: [serverMsg(1_700_000_000_000)] });
    expect(getFlushBoundaryTs(room, null, null)).toBeUndefined();
    expect(getFlushBoundaryTs(room, null, undefined)).toBeUndefined();
    expect(getFlushBoundaryTs(room, null, 0)).toBeUndefined();
    expect(getFlushBoundaryTs(room, null, -5)).toBeUndefined();
  });

  it('passes a sane boundary through', () => {
    const room = makeRoom({
      messages: [serverMsg(1_700_000_000_000), serverMsg(1_700_000_050_000)],
    });
    expect(getFlushBoundaryTs(room, null, 1_700_000_000_000)).toBe(
      1_700_000_000_000
    );
  });

  it('clamps a boundary that sits past the newest acked message', () => {
    const room = makeRoom({ messages: [serverMsg(1_700_000_000_000)] });
    expect(getFlushBoundaryTs(room, null, 1_700_999_000_000)).toBe(
      1_700_000_000_000
    );
  });

  it('is undefined when there is nothing acked to clamp against', () => {
    const room = makeRoom({
      messages: [pendingMsg(1_700_999_000_000, 'send-text-message-1-1')],
    });
    expect(getFlushBoundaryTs(room, null, 1_700_999_000_000)).toBeUndefined();
    expect(getFlushBoundaryTs(null, null, 1_700_999_000_000)).toBeUndefined();
  });

  it('ignores a pending message even with a boundary set (bug #38 exclusion still applies)', () => {
    const room = makeRoom({
      messages: [
        serverMsg(1_700_000_000_000),
        pendingMsg(1_700_999_000_000, 'send-text-message-1700999000000-1'),
      ],
    });
    // Boundary sits ahead of the real newest acked message (1_700_000_000_000)
    // but behind the pending message's device-clock date - must clamp to
    // the real acked message, never trust the pending device timestamp.
    expect(getReadMarkerTimestamp(room, null, 1_700_000_500_000)).toBe(
      1_700_000_000_000
    );
  });
});
