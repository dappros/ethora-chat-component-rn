/**
 * Second leaf-helper bundle.
 *
 *   - createMainMessageForThread (thread-parent payload serialiser)
 *   - updatedChatLastTimestamps   (dispatches setLastViewedTimestamp
 *                                  per jid)
 *   - handleXmppError.findError   (recursive XMPP error-node walker)
 *   - getUnnamedUsers              (dedupe by user.id + filter "deleted")
 *   - localStorageUser             (web-only — kept for parity)
 *
 * Web-only `block_scroll` is intentionally skipped — its
 * HTMLElement/TouchEvent/WheelEvent surface doesn't exist in RN, so
 * the file is dead code in this project.
 */

import { createMainMessageForThread } from '../src/helpers/createMainMessageForThread';
import { updatedChatLastTimestamps } from '../src/helpers/updatedChatLastTimestamps';
import { findError } from '../src/helpers/handleXmppError';
import { getUnnamedUsers } from '../src/helpers/getUnnamedUsers';
import { setLastViewedTimestamp } from '../src/roomStore/roomsSlice';

describe('createMainMessageForThread', () => {
  it('serialises core message fields under the wire shape consumed by reply UI', () => {
    const msg = {
      body: 'parent text',
      id: 'msg-1',
      user: { name: 'Alice' },
      date: '2026-05-15T00:00:00Z',
      location: 'http://img/a.png',
      locationPreview: 'http://img/a-preview.png',
      mimetype: 'image/png',
      roomJid: 'r@h',
    } as any;
    const out = JSON.parse(createMainMessageForThread(msg));
    expect(out).toMatchObject({
      text: 'parent text',
      id: 'msg-1',
      userName: 'Alice',
      createdAt: '2026-05-15T00:00:00Z',
      imageLocation: 'http://img/a.png',
      imagePreview: 'http://img/a-preview.png',
      mimeType: 'image/png',
      roomJid: 'r@h',
    });
  });

  it('includes the empty-string placeholder fields the receiver expects', () => {
    const msg = {
      body: 'x',
      id: '1',
      user: { name: 'X' },
      date: '2026',
      roomJid: 'r@h',
    } as any;
    const out = JSON.parse(createMainMessageForThread(msg));
    // The receiver's payload schema pins these — pin them here too so
    // a refactor that "tidies up" the empty strings doesn't break the
    // downstream contract.
    expect(out.size).toBe('');
    expect(out.duration).toBe('');
    expect(out.waveForm).toBe('');
    expect(out.attachmentId).toBe('');
    expect(out.wrappable).toBe('');
    expect(out.nftActionType).toBe('');
    expect(out.contractAddress).toBe('');
    expect(out.nftId).toBe('');
  });
});

describe('updatedChatLastTimestamps', () => {
  it('dispatches one setLastViewedTimestamp per (jid, timestamp) entry', () => {
    const dispatch = jest.fn();
    updatedChatLastTimestamps(
      { 'a@h': '1700000000000', 'b@h': '1700000001000' } as any,
      dispatch
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith(
      setLastViewedTimestamp({ chatJID: 'a@h', timestamp: 1700000000000 })
    );
    expect(dispatch).toHaveBeenCalledWith(
      setLastViewedTimestamp({ chatJID: 'b@h', timestamp: 1700000001000 })
    );
  });

  it('coerces an absent timestamp to 0 (unknown-marker fallback)', () => {
    const dispatch = jest.fn();
    updatedChatLastTimestamps(
      { 'a@h': '' } as any,
      dispatch
    );
    expect(dispatch).toHaveBeenCalledWith(
      setLastViewedTimestamp({ chatJID: 'a@h', timestamp: 0 })
    );
  });

  it('is a no-op for a falsy input', () => {
    const dispatch = jest.fn();
    updatedChatLastTimestamps(null as any, dispatch);
    updatedChatLastTimestamps(undefined as any, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('handleXmppError.findError', () => {
  // Fake DOM-ish Element with the fields the source reads (.tagName,
  // .children, .textContent). Children form a tree, not a flat list.
  const node = (
    tagName: string,
    textContent: string | null = null,
    ...children: any[]
  ): any => ({ tagName, textContent, children });

  it('returns hasError=false when no <error> appears in the subtree', () => {
    const tree = node(
      'iq',
      null,
      node('query', null, node('item', 'something'))
    );
    expect(findError(tree)).toEqual({ hasError: false, errorText: null });
  });

  it('returns hasError=true with the trimmed text when an <error> is at the root', () => {
    const tree = node('error', '  insufficient privileges  ');
    expect(findError(tree)).toEqual({
      hasError: true,
      errorText: 'insufficient privileges',
    });
  });

  it('finds an <error> nested several levels deep', () => {
    const tree = node(
      'iq',
      null,
      node('query', null, node('foo', null, node('error', 'forbidden')))
    );
    expect(findError(tree)).toEqual({
      hasError: true,
      errorText: 'forbidden',
    });
  });

  it('returns null errorText when the error node has empty text', () => {
    const tree = node('error', '');
    expect(findError(tree).hasError).toBe(true);
    expect(findError(tree).errorText).toBeNull();
  });
});

describe('getUnnamedUsers', () => {
  const msg = (id: string, name: string) =>
    ({
      id: `m-${id}`,
      user: { id, name },
      body: 'x',
      date: '2026',
      roomJid: 'r@h',
    } as any);

  it('returns only users whose name contains "deleted" (case-insensitive)', () => {
    const out = getUnnamedUsers([
      msg('u1', 'Alice'),
      msg('u2', 'Deleted User'),
      msg('u3', 'Bob'),
      msg('u4', 'a DELETED account'),
    ]);
    expect(out.map((u: any) => u.id).sort()).toEqual(['u2', 'u4']);
  });

  it('dedupes by user.id before filtering', () => {
    const out = getUnnamedUsers([
      msg('u1', 'Deleted User'),
      msg('u1', 'Deleted User'),
      msg('u1', 'Deleted User'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns [] when no users match', () => {
    expect(
      getUnnamedUsers([msg('u1', 'Alice'), msg('u2', 'Bob')])
    ).toEqual([]);
  });
});
