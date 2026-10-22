/**
 * The chat profile's Media tab lists every picture and video of the loaded
 * history, newest first, each with the message it came from (Delete only on
 * one's own, Reply only where replies are on). Documents, deleted, pending
 * and sealed messages stay out.
 */
jest.mock('../src/context/xmppProvider', () => ({ useXmppClient: () => ({ client: null }) }));

import { collectRoomMedia, withChatSiblings } from '../src/helpers/roomMedia';

const ROOM = 'room@conference.x';
const msg = (id: string, over: any = {}) => ({
  id,
  roomJid: ROOM,
  body: 'media',
  date: '2026-10-20T10:00:00Z',
  isMediafile: 'true',
  location: `https://files.x/${id}.jpg`,
  mimetype: 'image/jpeg',
  user: { id: 'other', firstName: 'Bob', lastName: 'Ray' },
  ...over,
});

const me = { xmppUsername: 'me', walletAddress: 'me' } as any;

describe('collectRoomMedia', () => {
  it('keeps pictures and videos, newest first, with their message', () => {
    const files = collectRoomMedia(
      [
        msg('1'),
        msg('2', { location: 'https://files.x/doc.pdf', mimetype: 'application/pdf' }),
        msg('3', { location: 'https://files.x/v.mp4', mimetype: 'video/mp4', user: { id: 'me' } }),
        msg('4', { isDeleted: true }),
        msg('5', { pending: true }),
        msg('6', { clientEncrypted: 'true' }),
        msg('7', { isMediafile: undefined }),
      ] as any,
      ROOM,
      { me, interactive: true, repliesOn: true }
    );
    expect(files.map((f) => f.source?.messageId)).toEqual(['3', '1']);
    expect(files[0]).toMatchObject({ mimetype: 'video/mp4', source: { own: true } });
    expect(files[1]).toMatchObject({
      source: { own: false, senderName: 'Bob Ray', replyTo: { id: '1', chatJID: ROOM } },
    });
  });

  it('drops Reply and Delete when interactions or replies are off', () => {
    const own = [msg('1', { user: { id: 'me' } })] as any;
    expect(
      collectRoomMedia(own, ROOM, { me, interactive: false, repliesOn: true })[0]!.source
    ).toMatchObject({ own: false, replyTo: undefined });
    expect(
      collectRoomMedia(own, ROOM, { me, interactive: true, repliesOn: false })[0]!.source
    ).toMatchObject({ own: true, replyTo: undefined });
  });
});

describe('withChatSiblings', () => {
  const options = { me, interactive: true, repliesOn: true };
  const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, '0')}:00Z`;
  const thread = (id: string) => JSON.stringify({ id, text: 'parent', roomJid: ROOM });
  const opened = (id: string, url = `https://files.x/${id}.jpg?token=abc`) => ({
    fileName: `${id}.jpg`,
    fileURL: url,
    mimetype: 'image/jpeg',
    source: { messageId: id, roomJid: ROOM, own: false },
  });

  const messages = [
    msg('3', { date: at(3) }),
    msg('1', { date: at(1) }),
    msg('2', { date: at(2), location: 'https://files.x/doc.pdf', mimetype: 'application/pdf' }),
    msg('4', { date: at(4), location: 'https://files.x/v.mp4', mimetype: 'video/mp4' }),
    msg('t1', { date: at(5), isReply: 'true', mainMessage: thread('1') }),
    msg('t2', { date: at(6), isReply: 'true', mainMessage: thread('1') }),
    msg('c1', { date: at(7), isReply: 'true', mainMessage: thread('1'), showInChannel: 'true' }),
  ] as any;

  it('pages through the channel media, oldest first, from the opened file', () => {
    const file = withChatSiblings(opened('3'), messages, options)!;
    expect(file.siblings!.map((f) => f.source?.messageId)).toEqual(['1', '3', '4', 'c1']);
    expect(file.index).toBe(1);
    // The bubble's own source stays with the opened file.
    expect(file.source).toEqual(opened('3').source);
  });

  it('keeps a thread-only reply inside its thread', () => {
    const file = withChatSiblings(opened('t2'), messages, options)!;
    expect(file.siblings!.map((f) => f.source?.messageId)).toEqual(['t1', 't2']);
    expect(file.index).toBe(1);
  });

  it('finds each file of an album by its address', () => {
    const album = [
      msg('a', { location: 'https://files.x/a0.jpg,https://files.x/a1.jpg' }),
    ] as any;
    const file = withChatSiblings(
      opened('a', 'https://files.x/a1.jpg?token=abc'),
      album,
      options
    )!;
    expect(file.siblings).toHaveLength(2);
    expect(file.index).toBe(1);
  });

  it('gives up on a file it cannot place', () => {
    expect(withChatSiblings(opened('missing'), messages, options)).toBeNull();
    expect(withChatSiblings(opened('3', 'https://files.x/other.jpg'), messages, options)).toBeNull();
    expect(withChatSiblings({ ...opened('3'), source: undefined }, messages, options)).toBeNull();
  });
});
