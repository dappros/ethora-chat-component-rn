/**
 * getServerReadTimestamp - resolves a "read up to here" marker from
 * SERVER time (never Date.now()), so a device with a fast clock can
 * never write a future marker that permanently blocks later corrections
 * (bug #38).
 */

import { getServerReadTimestamp } from '../src/helpers/getServerReadTimestamp';
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
