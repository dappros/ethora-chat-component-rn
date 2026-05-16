/**
 * createMessageFromXml — pure helper L1 tests.
 *
 * High-leverage: this helper runs on EVERY incoming message, both
 * realtime (positional convention) and MAM history replay (wrapped
 * convention). It's the choke point that turns raw XML attrs into the
 * canonical IMessage the reducer + UI consume. A drift in name
 * synthesis, date fallback, or id fallback shows up as "?? said
 * nothing" rows in production, so we pin the contract.
 */

import { createMessageFromXml } from '../src/helpers/createMessageFromXml';

describe('createMessageFromXml — wrapped convention (MAM history)', () => {
  it('flattens the inner <data> attrs onto the outer fields', async () => {
    const msg = await createMessageFromXml({
      data: {
        senderFirstName: 'Alice',
        senderLastName: 'Anderson',
        senderJID: 'alice@host/r1',
        someExtra: 'x',
      },
      id: 'msg-1',
      body: 'hello',
      roomJid: 'r@h',
      date: '2026-05-15T10:00:00Z',
    } as any);
    expect(msg.id).toBe('msg-1');
    expect(msg.body).toBe('hello');
    expect(msg.roomJid).toBe('r@h');
    expect(msg.user.name).toBe('Alice Anderson');
    expect((msg.user as any).firstName).toBe('Alice');
    expect((msg.user as any).lastName).toBe('Anderson');
    // Inner fields are flattened onto the merged result.
    expect((msg as any).senderJID).toBe('alice@host/r1');
    expect((msg as any).someExtra).toBe('x');
  });

  it('preserves explicit user.id when present, otherwise uses senderJID local', async () => {
    const explicit = await createMessageFromXml({
      data: { senderJID: 'alice@host' },
      id: '1',
      body: 'b',
      user: { id: 'override-id' },
    } as any);
    expect(explicit.user.id).toBe('override-id');

    const derived = await createMessageFromXml({
      data: { senderJID: 'alice@host' },
      id: '1',
      body: 'b',
    } as any);
    expect(derived.user.id).toBe('alice');
  });
});

describe('createMessageFromXml — positional convention (realtime)', () => {
  it('treats arg as data attrs and pulls body from the body element', async () => {
    const bodyEl = { getText: () => 'realtime body' };
    const msg = await createMessageFromXml(
      {
        senderFirstName: 'Bob',
        senderLastName: 'Brown',
        senderJID: 'bob@host',
      } as any,
      bodyEl,
      'rt-id',
      'r@h/bob'
    );
    expect(msg.id).toBe('rt-id');
    expect(msg.body).toBe('realtime body');
    expect(msg.roomJid).toBe('r@h'); // resource stripped from `from`
    expect(msg.user.name).toBe('Bob Brown');
    expect((msg as any).xmppFrom).toBe('r@h/bob');
  });

  it('accepts a string body in the positional path', async () => {
    const msg = await createMessageFromXml(
      { senderJID: 'alice@host' } as any,
      'inline body',
      'id-1',
      'r@h/alice'
    );
    expect(msg.body).toBe('inline body');
  });

  it('reads .text when the body element exposes it instead of getText()', async () => {
    const msg = await createMessageFromXml(
      { senderJID: 'alice@host' } as any,
      { text: 'fallback body' } as any,
      'id-1',
      'r@h/alice'
    );
    expect(msg.body).toBe('fallback body');
  });

  it('flags isDeleted when the positional `deleted` flag is set', async () => {
    const msg = await createMessageFromXml(
      { senderJID: 'alice@host' } as any,
      'b',
      'id-1',
      'r@h/alice',
      true
    );
    expect(msg.isDeleted).toBe(true);
  });
});

describe('createMessageFromXml — date fallback', () => {
  it('keeps the explicit date when supplied', async () => {
    const explicit = '2026-05-15T10:00:00.000Z';
    const msg = await createMessageFromXml({
      data: {},
      id: '1',
      body: 'b',
      date: explicit,
    } as any);
    expect(msg.date).toBe(explicit);
  });

  it('derives the date from the microsecond-prefix in the id when missing', async () => {
    // 1700000000000 = 2023-11-14T22:13:20.000Z; the helper takes the
    // first 13 chars from a 16+ char id and uses them as a millisecond
    // timestamp.
    const id = '1700000000000123';
    const msg = await createMessageFromXml({
      data: {},
      id,
      body: 'b',
    } as any);
    expect(msg.date).toBe('2023-11-14T22:13:20.000Z');
  });

  it('falls back to "now" when id has no numeric prefix', async () => {
    const msg = await createMessageFromXml({
      data: {},
      id: 'not-a-number',
      body: 'b',
    } as any);
    const parsed = new Date(msg.date as string).getTime();
    expect(Number.isFinite(parsed)).toBe(true);
    // Within 10s of "now" — very loose, just confirms we got a valid date.
    expect(Math.abs(parsed - Date.now())).toBeLessThan(10_000);
  });

  it('generates a fallback id (Date.now() string) when id is missing', async () => {
    const before = Date.now();
    const msg = await createMessageFromXml({
      data: {},
      body: 'b',
    } as any);
    const idNum = Number(msg.id);
    expect(Number.isFinite(idNum)).toBe(true);
    expect(idNum).toBeGreaterThanOrEqual(before - 1);
  });
});

describe('createMessageFromXml — user name synthesis', () => {
  it('combines first + last when both are present', async () => {
    const msg = await createMessageFromXml({
      data: { senderFirstName: 'Alice', senderLastName: 'Anderson' },
      id: '1',
      body: 'b',
    } as any);
    expect(msg.user.name).toBe('Alice Anderson');
  });

  it('falls back to fullName when first/last are missing', async () => {
    const msg = await createMessageFromXml({
      data: { fullName: 'Alice The Great' },
      id: '1',
      body: 'b',
    } as any);
    expect(msg.user.name).toBe('Alice The Great');
  });

  it('falls back to senderJID local when nothing else is available', async () => {
    const msg = await createMessageFromXml({
      data: { senderJID: 'alice@host' },
      id: '1',
      body: 'b',
    } as any);
    expect(msg.user.name).toBe('alice');
  });

  it('falls back to user.id when even senderJID is empty', async () => {
    const msg = await createMessageFromXml({
      data: {},
      id: '1',
      body: 'b',
      user: { id: 'fallback-id' },
    } as any);
    expect(msg.user.name).toBe('fallback-id');
  });

  it('preserves an existing user.name without overwriting from sender attrs', async () => {
    const msg = await createMessageFromXml({
      data: { senderFirstName: 'Alice', senderLastName: 'Anderson' },
      id: '1',
      body: 'b',
      user: { id: 'u', name: 'Preserved Name' },
    } as any);
    expect(msg.user.name).toBe('Preserved Name');
  });
});

describe('createMessageFromXml — defensive', () => {
  it('returns a stub instead of throwing when arg is missing', async () => {
    const msg = await createMessageFromXml(undefined as any);
    expect(msg.id).toBe('');
    expect(msg.body).toBe('');
    expect(msg.roomJid).toBe('');
  });
});
