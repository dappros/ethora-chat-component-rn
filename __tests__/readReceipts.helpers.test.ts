/**
 * Pure receipt rules (src/helpers/readReceipts.ts): which message the read
 * watermark names, sent / delivered / seen for our own messages, the tap
 * details text, and the gates that switch read markers off.
 */
import {
  computeReadWatermark,
  describeReceipt,
  getReadWatermarkMessageId,
  getReceiptStatus,
  isReceiptMarkerId,
  receiptNameFor,
  RECEIPT_NAME_LIMIT,
  selectSeenBy,
  viewersAtOrAfter,
} from '../src/helpers/readReceipts';
import type { IMessage, IRoom } from '../src/types/types';

const ROOM = 'room1@conference.example.com';
const ME = 'me_user';
const THEM = 'them_user';

// Archive-style ids: 13-digit millisecond prefix so msgSortableMs orders them.
const id = (n: number) => String(1700000000000 + n).padStart(13, '0') + '000000';
const msg = (n: number, from: string, extra: Partial<IMessage> = {}): IMessage =>
  ({
    id: id(n),
    body: `m${n}`,
    date: new Date(1700000000000 + n).toISOString(),
    roomJid: ROOM,
    user: { id: from, name: from },
    ...extra,
  } as unknown as IMessage);

const room = (
  messages: IMessage[],
  extra: Partial<IRoom> = {}
): Pick<IRoom, 'messages' | 'lastDisplayedByUser'> & Partial<IRoom> =>
  ({ messages, ...extra } as any);

describe('isReceiptMarkerId', () => {
  it('recognises the receipt and marker id prefixes only', () => {
    expect(isReceiptMarkerId('message-received:1')).toBe(true);
    expect(isReceiptMarkerId('message-displayed:1')).toBe(true);
    expect(isReceiptMarkerId('message-reaction:1')).toBe(false);
    expect(isReceiptMarkerId('1700000000000000')).toBe(false);
    expect(isReceiptMarkerId(undefined)).toBe(false);
  });
});

describe('getReadWatermarkMessageId', () => {
  it('names the newest message when someone else sent it', () => {
    const r = room([msg(1, ME), msg(2, THEM)]);
    expect(getReadWatermarkMessageId(r, ME)).toBe(id(2));
  });

  it('sends nothing when the newest message is our own', () => {
    const r = room([msg(1, THEM), msg(2, ME)]);
    expect(getReadWatermarkMessageId(r, ME)).toBeNull();
  });

  it('skips optimistic, divider and call-log rows when picking the newest', () => {
    const r = room([
      msg(1, THEM),
      msg(2, THEM, { pending: true }),
      msg(3, THEM, { id: 'delimiter-new' } as any),
      msg(4, THEM, { id: 'calllog-abc' } as any),
    ]);
    expect(getReadWatermarkMessageId(r, ME)).toBe(id(1));
  });

  it('is null for an empty room or an unknown reader', () => {
    expect(getReadWatermarkMessageId(room([]), ME)).toBeNull();
    expect(getReadWatermarkMessageId(room([msg(1, THEM)]), '')).toBeNull();
  });

  it('with a read boundary names the newest message at or before it', () => {
    const r = room([msg(1, THEM), msg(2, THEM), msg(3, THEM)]);
    expect(getReadWatermarkMessageId(r, ME, 1700000000002)).toBe(id(2));
  });

  it('with a boundary before every message names nothing', () => {
    const r = room([msg(5, THEM)]);
    expect(getReadWatermarkMessageId(r, ME, 1700000000001)).toBeNull();
  });
});

describe('viewersAtOrAfter / selectSeenBy', () => {
  const base = () =>
    room([msg(1, ME), msg(2, THEM), msg(3, ME), msg(4, THEM)], {
      lastDisplayedByUser: { [THEM]: id(3), third: id(1) },
    });

  it('lists the other occupants whose watermark is at or after the message', () => {
    expect(viewersAtOrAfter(base(), id(1), ME)).toEqual([THEM, 'third']);
  });

  it('counts a watermark that sits exactly on the message', () => {
    const r = base();
    expect(viewersAtOrAfter(r, id(3), ME)).toEqual([THEM]);
  });

  it('does not count a watermark before the message', () => {
    const r = base();
    expect(viewersAtOrAfter(r, id(4), ME)).toEqual([]);
  });

  it('never counts our own watermark', () => {
    const r = room([msg(1, ME)], { lastDisplayedByUser: { [ME]: id(1) } });
    expect(viewersAtOrAfter(r, id(1), ME)).toEqual([]);
  });

  it('returns a message missing from the list as nobody', () => {
    expect(viewersAtOrAfter(base(), id(99), ME)).toEqual([]);
  });

  it('returns the same shared empty array when nobody has seen it (shallowEqual-stable)', () => {
    const r = room([msg(1, ME)]);
    const a = viewersAtOrAfter(r, id(1), ME);
    const b = viewersAtOrAfter(r, id(1), ME);
    expect(a).toEqual([]);
    expect(a).toBe(b);
  });

  it('selectSeenBy reads the room by id from the store-shaped state', () => {
    const state = { rooms: { rooms: { [ROOM]: base() } } };
    expect(selectSeenBy(state as any, ROOM, id(3), ME)).toEqual([THEM]);
    expect(selectSeenBy(state as any, 'missing@x', id(3), ME)).toEqual([]);
  });
});

describe('getReceiptStatus', () => {
  const sender = (receivedBy?: Record<string, number>) =>
    ({ id: id(2), receivedBy } as Pick<IMessage, 'id' | 'receivedBy'>);

  it('is sent when nobody has acknowledged or displayed it', () => {
    const r = room([msg(2, ME)]);
    expect(getReceiptStatus(sender(), r, ME).status).toBe('sent');
  });

  it('is delivered when another occupant acknowledged it', () => {
    const r = room([msg(2, ME)]);
    const result = getReceiptStatus(sender({ [THEM]: 5 }), r, ME);
    expect(result.status).toBe('delivered');
    expect(result.deliveredTo).toEqual([THEM]);
  });

  it('a receipt from ourselves (our own echo) is not delivery', () => {
    const r = room([msg(2, ME)]);
    expect(getReceiptStatus(sender({ [ME]: 5 }), r, ME).status).toBe('sent');
  });

  it('is seen when another occupant displayed it, and seen wins over delivered', () => {
    const r = room([msg(2, ME), msg(3, THEM)], { lastDisplayedByUser: { [THEM]: id(3) } });
    const result = getReceiptStatus(sender({ [THEM]: 5 }), r, ME);
    expect(result.status).toBe('seen');
    expect(result.seenBy).toEqual([THEM]);
  });
});

describe('describeReceipt and receiptNameFor', () => {
  const t = (key: string, vars?: Record<string, string | number>) => {
    const table: Record<string, string> = {
      'message.receipt.sent': 'Sent',
      'message.receipt.delivered': 'Delivered',
      'message.receipt.read': 'Read',
      'message.receipt.readBy': 'Read by {names}',
      'message.receipt.deliveredTo': 'Delivered to {names}',
    };
    return (table[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''));
  };
  const nameOf = (u: string) => `N(${u})`;

  it('a 1:1 room says only Read or Delivered', () => {
    expect(
      describeReceipt({ status: 'seen', isGroup: false, seenBy: [THEM], deliveredTo: [THEM], nameOf, t })
    ).toBe('Read');
    expect(
      describeReceipt({ status: 'delivered', isGroup: false, seenBy: [], deliveredTo: [THEM], nameOf, t })
    ).toBe('Delivered');
  });

  it('a group lists who read it, and who it was delivered to', () => {
    expect(
      describeReceipt({ status: 'seen', isGroup: true, seenBy: ['a', 'b'], deliveredTo: [], nameOf, t })
    ).toBe('Read by N(a), N(b)');
    expect(
      describeReceipt({ status: 'delivered', isGroup: true, seenBy: [], deliveredTo: ['c'], nameOf, t })
    ).toBe('Delivered to N(c)');
  });

  it('caps the name list and adds the rest as +N', () => {
    const many = Array.from({ length: RECEIPT_NAME_LIMIT + 2 }, (_, i) => `u${i}`);
    const text = describeReceipt({ status: 'seen', isGroup: true, seenBy: many, deliveredTo: [], nameOf, t });
    expect(text).toBe(
      `Read by ${many.slice(0, RECEIPT_NAME_LIMIT).map(nameOf).join(', ')} +2`
    );
  });

  it('sent is always the plain Sent text', () => {
    expect(
      describeReceipt({ status: 'sent', isGroup: true, seenBy: [], deliveredTo: [], nameOf, t })
    ).toBe('Sent');
  });

  it('receiptNameFor prefers the usersSet name and falls back to the username', () => {
    const usersSet = { [THEM]: { firstName: 'Ann', lastName: 'Lee' } };
    expect(receiptNameFor(usersSet, THEM)).toBe('Ann Lee');
    expect(receiptNameFor(usersSet, 'stranger')).toBe('stranger');
    expect(receiptNameFor(undefined, 'stranger')).toBe('stranger');
  });
});

describe('computeReadWatermark gates', () => {
  const store = (overrides: Record<string, any> = {}) => ({
    chatSettingStore: {
      user: { xmppUsername: ME },
      config: {},
      ...(overrides.config ? { config: overrides.config } : {}),
    },
    rooms: {
      rooms: { [ROOM]: room([msg(1, ME), msg(2, THEM)]) as IRoom },
      visibleRoomJID: ROOM,
      jumpWindow: null,
      readBoundaries: {},
      ...(overrides.rooms || {}),
    },
  });

  it('names the newest message while the room is on screen', () => {
    expect(computeReadWatermark(store() as any, ROOM)).toBe(id(2));
  });

  it('sends nothing for a room that is not the one on screen', () => {
    expect(computeReadWatermark(store({ rooms: { visibleRoomJID: null } }) as any, ROOM)).toBeNull();
    expect(
      computeReadWatermark(store({ rooms: { visibleRoomJID: 'other@x' } }) as any, ROOM)
    ).toBeNull();
  });

  it('sends nothing while a jump window shows old history of this room', () => {
    const s = store({ rooms: { jumpWindow: { roomJID: ROOM } } });
    expect(computeReadWatermark(s as any, ROOM)).toBeNull();
  });

  it('a jump window in another room does not block this one', () => {
    const s = store({ rooms: { jumpWindow: { roomJID: 'other@x' } } });
    expect(computeReadWatermark(s as any, ROOM)).toBe(id(2));
  });

  it('is switched off by disableLastRead and by disableReadReceipts', () => {
    expect(computeReadWatermark(store({ config: { disableLastRead: true } }) as any, ROOM)).toBeNull();
    expect(
      computeReadWatermark(store({ config: { disableReadReceipts: true } }) as any, ROOM)
    ).toBeNull();
  });

  it('respects a scroll boundary', () => {
    const s = store({ rooms: { readBoundaries: { [ROOM]: 1700000000001 } } });
    expect(computeReadWatermark(s as any, ROOM)).toBe(id(1));
  });
});
