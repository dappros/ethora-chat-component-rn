/**
 * Wire format of a media message that carries one or several files.
 *
 *   - one file, no caption: byte-identical to the stanza sendMediaMessage
 *     produced before multi-attach (pinned below)
 *   - several files: the flat <data> fields describe attachment #0, and the
 *     whole list rides on <data attachments='JSON'> in selection order
 *   - a caption on a plain room: <data caption=... captionMentions=...>
 *   - a caption on an e2ee room: inside the sealed <body>, never an attribute
 */
import { sendMediaMessage } from '../src/networking/xmpp/sendMediaMessage.xmpp';
import type { IAttachment } from '../src/types/types';

const mockSendSealedMedia = jest.fn();
let mockEncrypted = false;
jest.mock('../src/e2ee/send', () => ({
  shouldEncrypt: () => mockEncrypted,
  sendSealedMedia: (...args: unknown[]) => (mockSendSealedMedia as any)(...args),
}));

const makeClient = () => {
  const send = jest.fn(async () => undefined);
  const client: any = {
    send,
    status: 'online',
    options: { service: 'wss://xmpp.test/ws' },
    jid: { toString: () => '0xabc@xmpp.test/web-1' },
  };
  return { client, send };
};

const base = {
  firstName: 'Alice',
  lastName: 'A',
  walletAddress: '0xabc',
  chatName: 'Room',
  userAvatar: 'http://img/a.png',
  createdAt: 'c',
  expiresAt: 'e',
  fileName: 'doc.pdf',
  isVisible: true,
  location: 'http://files/doc.pdf',
  locationPreview: 'http://files/p.png',
  mimetype: 'application/pdf',
  originalName: 'doc.pdf',
  ownerKey: 'ok',
  size: '1024',
  duration: '0',
  updatedAt: 'u',
  userId: 'u1',
  waveForm: '',
  attachmentId: 'aid',
  isReply: false,
  showInChannel: false,
  mainMessage: '',
  roomJid: 'r@h',
};

const file = (n: number, extra: Partial<IAttachment> = {}): IAttachment => ({
  attachmentId: `att-${n}`,
  location: `https://files/${n}.jpg`,
  locationPreview: `https://files/${n}-p.jpg`,
  mimetype: 'image/jpeg',
  originalName: `photo-${n}.jpg`,
  fileName: `stored-${n}.jpg`,
  size: String(1000 + n),
  ...extra,
});

const dataOf = (stanza: any) => stanza.getChild('data');

beforeEach(() => {
  mockEncrypted = false;
  mockSendSealedMedia.mockReset();
});

describe('sendMediaMessage: single file', () => {
  it('stays byte-identical to the stanza it produced before multi-attach', () => {
    const { client, send } = makeClient();
    sendMediaMessage(client, 'r@h', base, 'fixed-id');
    expect(send.mock.calls[0][0].toString()).toBe(
      '<message id="fixed-id" type="groupchat" from="0xabc@xmpp.test/web-1" to="r@h"><body>media</body><store xmlns="urn:xmpp:hints"/><data xmlns="wss://xmpp.test/ws" senderJID="0xabc@xmpp.test/web-1" senderFirstName="Alice" senderLastName="A" senderWalletAddress="0xabc" tokenAmount="0" receiverMessageId="0" mucname="Room" photoURL="http://img/a.png" isMediafile="true" createdAt="c" expiresAt="e" fileName="doc.pdf" isVisible="true" location="http://files/doc.pdf" locationPreview="http://files/p.png" mimetype="application/pdf" originalName="doc.pdf" ownerKey="ok" size="1024" duration="0" updatedAt="u" userId="u1" waveForm="" attachmentId="aid" isReply="false" showInChannel="false" mainMessage="" roomJid="r@h" push="true"/></message>'
    );
  });

  it('a one-element attachments list adds nothing to the stanza', () => {
    const { client, send } = makeClient();
    sendMediaMessage(client, 'r@h', { ...base, attachments: [file(0)] }, 'fixed-id');
    const data = dataOf(send.mock.calls[0][0]);
    expect(data.attrs.attachments).toBeUndefined();
    expect(data.attrs.caption).toBeUndefined();
    expect(data.attrs.location).toBe('http://files/doc.pdf');
  });

  it('a whitespace-only caption is no caption', () => {
    const { client, send } = makeClient();
    sendMediaMessage(client, 'r@h', { ...base, caption: '   ' }, 'fixed-id');
    expect(dataOf(send.mock.calls[0][0]).attrs.caption).toBeUndefined();
  });
});

describe('sendMediaMessage: several files', () => {
  it('describes attachment #0 in the flat fields and lists all files in selection order', () => {
    const { client, send } = makeClient();
    const files = [file(0), file(1), file(2)];
    sendMediaMessage(client, 'r@h', { ...base, attachments: files }, 'multi-1');
    const stanza = send.mock.calls[0][0];
    expect(stanza.attrs.id).toBe('multi-1');
    expect(stanza.getChild('body')?.getText()).toBe('media');

    const data = dataOf(stanza);
    expect(data.attrs.location).toBe('https://files/0.jpg');
    expect(data.attrs.locationPreview).toBe('https://files/0-p.jpg');
    expect(data.attrs.originalName).toBe('photo-0.jpg');
    expect(data.attrs.fileName).toBe('stored-0.jpg');
    expect(data.attrs.mimetype).toBe('image/jpeg');
    expect(data.attrs.size).toBe('1000');

    const list = JSON.parse(data.attrs.attachments);
    expect(list.map((a: any) => a.attachmentId)).toEqual(['att-0', 'att-1', 'att-2']);
    expect(list.map((a: any) => a.location)).toEqual([
      'https://files/0.jpg',
      'https://files/1.jpg',
      'https://files/2.jpg',
    ]);
    expect(list[1]).toEqual({
      attachmentId: 'att-1',
      location: 'https://files/1.jpg',
      locationPreview: 'https://files/1-p.jpg',
      mimetype: 'image/jpeg',
      originalName: 'photo-1.jpg',
      fileName: 'stored-1.jpg',
      size: '1001',
    });
  });

  it('keeps local upload state off the wire', () => {
    const { client, send } = makeClient();
    const files = [
      file(0, { uploadStatus: 'uploading', uploadProgress: 40, localUrl: 'file:///x.jpg' }),
      file(1),
    ];
    sendMediaMessage(client, 'r@h', { ...base, attachments: files }, 'multi-2');
    const raw = dataOf(send.mock.calls[0][0]).attrs.attachments as string;
    expect(raw).not.toContain('uploadStatus');
    expect(raw).not.toContain('localUrl');
    expect(raw).not.toContain('file:///x.jpg');
  });
});

describe('sendMediaMessage: caption in a plain room', () => {
  it('puts the caption and its mention spans on <data>', () => {
    const { client, send } = makeClient();
    const mentions = [{ jid: 'bob@h', name: 'Bob', offset: 5, length: 4 }];
    sendMediaMessage(
      client,
      'r@h',
      {
        ...base,
        attachments: [file(0), file(1)],
        caption: 'look @Bob',
        captionMentions: mentions,
      },
      'cap-1'
    );
    const data = dataOf(send.mock.calls[0][0]);
    expect(data.attrs.caption).toBe('look @Bob');
    expect(JSON.parse(data.attrs.captionMentions)).toEqual(mentions);
    expect(send.mock.calls[0][0].getChild('body')?.getText()).toBe('media');
  });

  it('drops mention spans that no longer read "@Name" in the caption', () => {
    const { client, send } = makeClient();
    sendMediaMessage(
      client,
      'r@h',
      {
        ...base,
        caption: 'no mention here',
        captionMentions: [{ jid: 'bob@h', name: 'Bob', offset: 0, length: 4 }],
      },
      'cap-2'
    );
    const data = dataOf(send.mock.calls[0][0]);
    expect(data.attrs.caption).toBe('no mention here');
    expect(data.attrs.captionMentions).toBeUndefined();
  });

  it('a single file with a caption carries it the same way', () => {
    const { client, send } = makeClient();
    sendMediaMessage(client, 'r@h', { ...base, caption: 'just one' }, 'cap-3');
    expect(dataOf(send.mock.calls[0][0]).attrs.caption).toBe('just one');
  });
});

describe('sendMediaMessage: e2ee room', () => {
  beforeEach(() => {
    mockEncrypted = true;
  });

  it('seals the keys and the caption into the body, one key per file', () => {
    const { client, send } = makeClient();
    const mentions = [{ jid: 'bob@h', name: 'Bob', offset: 0, length: 4 }];
    sendMediaMessage(
      client,
      'r@h',
      {
        ...base,
        attachments: [file(0), file(1)],
        e2eeKeys: ['key-0', 'key-1'],
        caption: '@Bob secret',
        captionMentions: [{ ...mentions[0], offset: 0, length: 4 }],
      },
      'sealed-1'
    );
    expect(send).not.toHaveBeenCalled();
    expect(mockSendSealedMedia).toHaveBeenCalledTimes(1);
    const [, roomJID, id, body, cleartext] = mockSendSealedMedia.mock.calls[0];
    expect(roomJID).toBe('r@h');
    expect(id).toBe('sealed-1');
    expect(JSON.parse(body.getText())).toEqual({
      v: 1,
      keys: ['key-0', 'key-1'],
      caption: '@Bob secret',
      captionMentions: [{ jid: 'bob@h', name: 'Bob', offset: 0, length: 4 }],
    });

    const data = cleartext.find((el: any) => el.name === 'data');
    expect(data.attrs.caption).toBeUndefined();
    expect(data.attrs.captionMentions).toBeUndefined();
    expect(data.attrs.clientEncrypted).toBe('true');
    expect(JSON.parse(data.attrs.attachments).map((a: any) => a.attachmentId)).toEqual([
      'att-0',
      'att-1',
    ]);
  });

  it('keeps the body byte-identical to the old one when there is no caption', () => {
    const { client, send } = makeClient();
    sendMediaMessage(client, 'r@h', { ...base, e2eeKeys: ['key-0'] }, 'sealed-2');
    expect(send).not.toHaveBeenCalled();
    const body = mockSendSealedMedia.mock.calls[0][3];
    expect(body.getText()).toBe(JSON.stringify({ v: 1, keys: ['key-0'] }));
  });
});
