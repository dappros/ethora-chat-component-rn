/**
 * roomHeapSlice — reducer-level L1 tests.
 *
 * Heap is the in-flight buffer used while messages are being sent
 * (optimistic display + send-id correlation). These tests pin the
 * tiny reducer surface so future refactors don't silently drop
 * pending bubbles.
 *
 * Cluster mapping (QA_SCENARIOS.md):
 *   D. Send + duplication — heap fills on send, drains on ack
 */

import heapReducer, {
  addMessageToHeap,
  clearHeap,
  removeMessageFromHeapById,
} from '../src/roomStore/roomHeapSlice';
import type { IMessage } from '../src/types/types';

const initial = () => heapReducer(undefined, { type: '@@INIT' });

function makeMessage(
  id: string,
  overrides: Partial<IMessage> = {}
): IMessage {
  return {
    id,
    body: `body-${id}`,
    date: new Date('2026-05-01T10:00:00Z').toISOString(),
    pending: true,
    ...overrides,
  } as IMessage;
}

describe('roomHeapSlice — initial state', () => {
  it('boots with an empty heap', () => {
    expect(initial().messageHeap).toEqual([]);
  });
});

describe('roomHeapSlice — addMessageToHeap', () => {
  it('pushes a single message', () => {
    const next = heapReducer(initial(), addMessageToHeap(makeMessage('m1')));
    expect(next.messageHeap).toHaveLength(1);
    expect(next.messageHeap[0].id).toBe('m1');
  });

  it('preserves insertion order', () => {
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage('m1')));
    s = heapReducer(s, addMessageToHeap(makeMessage('m2')));
    s = heapReducer(s, addMessageToHeap(makeMessage('m3')));
    expect(s.messageHeap.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('allows multiple entries with the same id (caller is responsible for dedupe)', () => {
    // The reducer is intentionally dumb — the dedupe contract sits in
    // the middleware that drains the heap on ack. This test pins that
    // behavior so a future "auto-dedupe" change is a conscious choice.
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage('m1', { body: 'first' })));
    s = heapReducer(s, addMessageToHeap(makeMessage('m1', { body: 'second' })));
    expect(s.messageHeap).toHaveLength(2);
    expect(s.messageHeap[0].body).toBe('first');
    expect(s.messageHeap[1].body).toBe('second');
  });
});

describe('roomHeapSlice — removeMessageFromHeapById', () => {
  it('removes the first matching message', () => {
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage('m1')));
    s = heapReducer(s, addMessageToHeap(makeMessage('m2')));
    s = heapReducer(s, addMessageToHeap(makeMessage('m3')));
    s = heapReducer(s, removeMessageFromHeapById('m2'));
    expect(s.messageHeap.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('removes only the first occurrence when duplicates exist', () => {
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage('m1', { body: 'first' })));
    s = heapReducer(s, addMessageToHeap(makeMessage('m1', { body: 'second' })));
    s = heapReducer(s, removeMessageFromHeapById('m1'));
    expect(s.messageHeap).toHaveLength(1);
    expect(s.messageHeap[0].body).toBe('second');
  });

  it('is a no-op when id is not present', () => {
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage('m1')));
    s = heapReducer(s, removeMessageFromHeapById('does-not-exist'));
    expect(s.messageHeap.map((m) => m.id)).toEqual(['m1']);
  });

  it('is a no-op against an empty heap', () => {
    const next = heapReducer(initial(), removeMessageFromHeapById('m1'));
    expect(next.messageHeap).toEqual([]);
  });
});

describe('roomHeapSlice — clearHeap', () => {
  it('empties a populated heap', () => {
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage('m1')));
    s = heapReducer(s, addMessageToHeap(makeMessage('m2')));
    s = heapReducer(s, clearHeap());
    expect(s.messageHeap).toEqual([]);
  });

  it('is a no-op on an already-empty heap', () => {
    const next = heapReducer(initial(), clearHeap());
    expect(next.messageHeap).toEqual([]);
  });
});

describe('roomHeapSlice — send-id correlation pattern', () => {
  // Documents the optimistic-pending-bubble correlation pattern used
  // by sendTextMessage / sendMediaMessageStanza — the send id format
  // is `send-(text|media)-message-<ts>`, addressable for removal once
  // the server ack lands.
  it('round-trips a send-text-message-<ts> entry', () => {
    const sendId = `send-text-message-${Date.now()}`;
    let s = initial();
    s = heapReducer(s, addMessageToHeap(makeMessage(sendId)));
    expect(s.messageHeap.find((m) => m.id === sendId)).toBeDefined();
    s = heapReducer(s, removeMessageFromHeapById(sendId));
    expect(s.messageHeap.find((m) => m.id === sendId)).toBeUndefined();
  });
});
