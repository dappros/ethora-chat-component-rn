/**
 * Pure helpers ported from the web chat component (PR #100): member dedupe,
 * room user counts, opaque id shapes, history preload config resolver,
 * activity score, users set cap, safe keys.
 */
import { dedupeMembers, memberKey } from '../src/helpers/dedupeMembers';
import {
  adjustUsersCnt,
  getRoomUserCount,
  isRoomMembersTruncated,
} from '../src/helpers/roomUserCount';
import { isOpaqueXmppUserId } from '../src/helpers/xmppIdShape';
import { resolveHistoryPreloadConfig } from '../src/helpers/historyPreloadConfig';
import {
  getLastLocalMessageTimestamp,
  getRoomLastActivityScore,
} from '../src/helpers/roomActivityScore';
import {
  getTimestampFromUnknown,
  normalizeTimestampValue,
} from '../src/helpers/timestamp';
import { isLikelyMucJid, toRoomJid } from '../src/helpers/isLikelyMucJid';
import { parseMessageReference } from '../src/helpers/parseMessageReference';
import { createRoomFromApi } from '../src/helpers/createRoomFromApi';
import {
  hasSafeIdSegments,
  isReservedName,
  isSafeKey,
} from '../src/roomStore/safeKey';
import {
  USERS_SET_CAP,
  capUsersSet,
  mergeUsersSet,
} from '../src/roomStore/usersSetCap';

const members = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    _id: `id${i}`,
    firstName: 'F',
    lastName: String(i),
    xmppUsername: `u${i}`,
  }));

describe('dedupeMembers', () => {
  it('keeps the first occurrence and the order', () => {
    const out = dedupeMembers([
      { _id: '1', xmppUsername: 'A@host' },
      { _id: '2', xmppUsername: 'b' },
      { _id: '3', xmppUsername: 'a' },
    ] as any);
    expect(out.map((m) => m._id)).toEqual(['1', '2']);
  });
  it('falls back to _id and drops members without identity', () => {
    expect(memberKey({ _id: 'X1' } as any)).toBe('x1');
    expect(dedupeMembers([{ firstName: 'x' }, { _id: 'q' }] as any)).toHaveLength(1);
    expect(dedupeMembers(undefined)).toEqual([]);
  });
});

describe('getRoomUserCount', () => {
  it('prefers usersCnt over a truncated members array', () => {
    expect(getRoomUserCount({ members: members(30), usersCnt: 435 } as any)).toBe(435);
  });
  it('falls back to members.length when usersCnt is missing or smaller', () => {
    expect(getRoomUserCount({ members: members(3) } as any)).toBe(3);
    expect(getRoomUserCount({ members: members(3), usersCnt: 1 } as any)).toBe(3);
    expect(getRoomUserCount(undefined)).toBe(0);
  });
  it('detects truncation', () => {
    expect(isRoomMembersTruncated({ members: members(30), usersCnt: 435 } as any)).toBe(true);
    expect(isRoomMembersTruncated({ members: members(3), usersCnt: 3 } as any)).toBe(false);
  });
  it('adjusts the current count, not the truncated array length', () => {
    const room = { members: members(30), usersCnt: 435 } as any;
    expect(adjustUsersCnt(room, 1, 31)).toBe(436);
    expect(adjustUsersCnt(room, -1, 29)).toBe(434);
  });
});

describe('createRoomFromApi usersCnt', () => {
  it('uses the API usersCnt when members is truncated', () => {
    const room = createRoomFromApi(
      { name: 'a_b', type: 'public', title: 'T', members: members(30), usersCnt: 435 } as any,
      'conference.example.com'
    );
    expect(room?.usersCnt).toBe(435);
    expect(room?.jid).toBe('a_b@conference.example.com');
  });
  it('falls back to members.length without an API usersCnt', () => {
    const room = createRoomFromApi(
      { name: 'a_b', type: 'public', title: 'T', members: members(4) } as any,
      'conference.example.com'
    );
    expect(room?.usersCnt).toBe(4);
  });
  it('seeds apiUnreadCount and the API lastMessage', () => {
    const room = createRoomFromApi(
      {
        name: 'a_b',
        type: 'group',
        title: 'T',
        unreadCount: 3,
        lastMessage: { body: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
      } as any,
      'conference.example.com'
    );
    expect(room?.apiUnreadCount).toBe(3);
    expect(room?.unreadMessages).toBe(3);
    expect(typeof room?.apiUnreadSeededAt).toBe('number');
    expect(room?.lastMessage?.body).toBe('hello');
  });
  it('leaves apiUnreadCount undefined for a backend that sends none', () => {
    const room = createRoomFromApi(
      { name: 'a_b', type: 'group', title: 'T' } as any,
      'conference.example.com'
    );
    expect(room?.apiUnreadCount).toBeUndefined();
    expect(room?.apiUnreadSeededAt).toBeUndefined();
    expect(room?.unreadMessages).toBe(0);
  });
});

describe('isOpaqueXmppUserId', () => {
  const HEX = '646cc8dc96d4a4dc8f7b2f2d';
  const HEX2 = '67f6824df5995841ba432679';
  it('treats mongo-form ids as opaque', () => {
    expect(isOpaqueXmppUserId(`${HEX}_${HEX2}`)).toBe(true);
    expect(isOpaqueXmppUserId(HEX)).toBe(true);
    expect(isOpaqueXmppUserId(`${HEX}_${HEX2}@xmpp.host`)).toBe(true);
  });
  it('treats appId_uuid and appId_hex_suffix as opaque', () => {
    expect(isOpaqueXmppUserId('app1_123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isOpaqueXmppUserId(`${HEX}_123e4567-e89b-12d3-a456-426614174000`)).toBe(true);
    expect(isOpaqueXmppUserId(`${HEX}_${HEX2}_device1`)).toBe(true);
  });
  it('leaves human names and handles alone', () => {
    expect(isOpaqueXmppUserId('alice')).toBe(false);
    expect(isOpaqueXmppUserId('Alice Doe')).toBe(false);
    expect(isOpaqueXmppUserId('john_smith')).toBe(false);
    expect(isOpaqueXmppUserId('')).toBe(false);
    expect(isOpaqueXmppUserId(undefined)).toBe(false);
  });
});

describe('resolveHistoryPreloadConfig', () => {
  it('defaults to staged, top 8 rooms, concurrency 3', () => {
    expect(resolveHistoryPreloadConfig({})).toMatchObject({
      mode: 'staged',
      topRooms: 8,
      concurrency: 3,
    });
  });
  it('reads historyPreload', () => {
    expect(
      resolveHistoryPreloadConfig({
        historyPreload: { mode: 'staged', topRooms: 12, concurrency: 5 },
      })
    ).toMatchObject({ mode: 'staged', topRooms: 12, concurrency: 5 });
  });
  it("'all' has no room cap and 'off' is passed through", () => {
    expect(
      resolveHistoryPreloadConfig({ historyPreload: { mode: 'all', topRooms: 3 } }).topRooms
    ).toBe(0);
    expect(resolveHistoryPreloadConfig({ historyPreload: { mode: 'off' } }).mode).toBe('off');
  });
  it('falls back to the older historyQoS names', () => {
    expect(
      resolveHistoryPreloadConfig({
        historyQoS: { preloadTopKRooms: 20, stagedPreloadConcurrency: 2 },
      })
    ).toMatchObject({ mode: 'staged', topRooms: 20, concurrency: 2 });
  });
  it('keeps the legacy path when a host pinned stagedPreloadEnabled: false, unless mode is set', () => {
    expect(
      resolveHistoryPreloadConfig({ historyQoS: { stagedPreloadEnabled: false } }).mode
    ).toBe('legacy');
    expect(
      resolveHistoryPreloadConfig({
        historyPreload: { mode: 'staged' },
        historyQoS: { stagedPreloadEnabled: false },
      }).mode
    ).toBe('staged');
  });
  it('ignores junk numbers and maps the pass sizes', () => {
    expect(
      resolveHistoryPreloadConfig({ historyPreload: { topRooms: -1, concurrency: 0 } })
    ).toMatchObject({ topRooms: 8, concurrency: 3 });
    expect(
      resolveHistoryPreloadConfig({
        historyQoS: { stagedPreloadFirstPassSize: 2, stagedPreloadSecondPassSize: 40 },
      })
    ).toMatchObject({ firstPassSize: 2, secondPassSize: 40 });
  });
  it('the new object wins over the older names', () => {
    expect(
      resolveHistoryPreloadConfig({
        historyPreload: { topRooms: 4, concurrency: 1 },
        historyQoS: { preloadTopKRooms: 20, stagedPreloadConcurrency: 9 },
      })
    ).toMatchObject({ topRooms: 4, concurrency: 1 });
  });
});

describe('timestamps and activity score', () => {
  it('normalises seconds, microseconds and ISO strings to ms', () => {
    expect(normalizeTimestampValue(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestampValue(1_700_000_000_123_456)).toBe(1_700_000_000_123);
    expect(getTimestampFromUnknown('2026-01-01T00:00:00.000Z')).toBe(
      Date.parse('2026-01-01T00:00:00.000Z')
    );
    expect(getTimestampFromUnknown(null)).toBe(0);
  });
  it('the API lastMessage date counts and microseconds do not outrank ms', () => {
    const apiMs = Date.parse('2026-03-01T00:00:00.000Z');
    const room: any = {
      messages: [],
      lastMessage: { body: 'x', date: new Date(apiMs).toISOString() },
      messageStats: { lastMessageTimestamp: 1_700_000_000_123_456 },
    };
    expect(getRoomLastActivityScore(room)).toBe(apiMs);
    expect(getRoomLastActivityScore(undefined)).toBe(0);
  });
  it('last local message skips pending and the delimiter', () => {
    const room: any = {
      messages: [
        { id: '1', date: '2026-01-01T00:00:00.000Z' },
        { id: 'delimiter-new', date: '2026-02-01T00:00:00.000Z' },
        { id: '3', pending: true, date: '2026-03-01T00:00:00.000Z' },
      ],
    };
    expect(getLastLocalMessageTimestamp(room)).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
});

describe('isLikelyMucJid / toRoomJid / parseMessageReference', () => {
  it('accepts only conference JIDs', () => {
    expect(isLikelyMucJid('a_b@conference.x.com')).toBe(true);
    expect(isLikelyMucJid('usersSet')).toBe(false);
    expect(isLikelyMucJid('a@xmpp.x.com')).toBe(false);
  });
  it('refuses to manufacture a JID from slice keys', () => {
    expect(toRoomJid('usersSet', 'conference.x.com')).toBeNull();
    expect(toRoomJid('app_room', 'conference.x.com')).toBe('app_room@conference.x.com');
  });
  it('parses a reference and survives junk', () => {
    expect(parseMessageReference('{"id":"1"}')).toEqual({ id: '1' });
    expect(parseMessageReference('nope')).toBeNull();
    expect(parseMessageReference(undefined)).toBeNull();
  });
});

describe('safeKey', () => {
  it('rejects unsafe and non-string keys', () => {
    for (const k of ['__proto__', 'constructor', 'prototype', '', undefined, null, 1, {}]) {
      expect(isSafeKey(k)).toBe(false);
    }
    expect(isSafeKey('room@conference.example.com')).toBe(true);
  });
  it('reserved names and id segments', () => {
    expect(isReservedName('toString')).toBe(true);
    expect(isReservedName('alice')).toBe(false);
    expect(hasSafeIdSegments('app_user')).toBe(true);
    expect(hasSafeIdSegments('app_constructor')).toBe(false);
    expect(hasSafeIdSegments('app___proto__')).toBe(false);
  });
});

describe('usersSetCap', () => {
  const entry = (n: number) => ({ xmppUsername: `u${n}`, firstName: 'F' }) as any;
  it('drops the oldest-inserted entries past the cap', () => {
    const set: Record<string, any> = {};
    for (let i = 0; i < 10; i++) set[`u${i}`] = entry(i);
    capUsersSet(set, 4);
    expect(Object.keys(set)).toEqual(['u6', 'u7', 'u8', 'u9']);
  });
  it('merges: fresh wins, lazily fetched entries stay, refreshed keys move to the newest slot', () => {
    const set: Record<string, any> = { a: { firstName: 'old' }, b: { firstName: 'lazy' } };
    mergeUsersSet(set, { a: { firstName: 'fresh' }, c: { firstName: 'new' } });
    expect(set.a.firstName).toBe('fresh');
    expect(set.b.firstName).toBe('lazy');
    expect(Object.keys(set)).toEqual(['b', 'a', 'c']);
  });
  it('skips unsafe keys and honours the default cap', () => {
    const set: Record<string, any> = {};
    mergeUsersSet(set, JSON.parse('{"__proto__":{"x":1},"constructor":{"x":1},"ok":{"x":1}}'));
    expect(Object.keys(set)).toEqual(['ok']);
    expect(({} as any).x).toBeUndefined();
    const big: Record<string, any> = {};
    for (let i = 0; i < USERS_SET_CAP + 20; i++) big[`k${i}`] = entry(i);
    capUsersSet(big);
    expect(Object.keys(big)).toHaveLength(USERS_SET_CAP);
    expect(big.k0).toBeUndefined();
    expect(big[`k${USERS_SET_CAP + 19}`]).toBeDefined();
  });
});
