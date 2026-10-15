import {
  COMMA_LIST_STANZA,
  FILES,
  N1_STANZA,
  PLAIN_MEDIA_STANZA,
  multiStanza,
  stanza,
  toMessage,
  toPositionalMessage,
} from './fixtures/mediaStanzas';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  getMessageAttachments,
  isMediaMessage,
} from '../src/helpers/attachments';
import { getMessageCaption } from '../src/helpers/caption';
import { normalizeMediaDataAttrs } from '../src/helpers/mediaWireData';
import { parseSealedMediaPayload } from '../src/e2ee/sealedBody';

describe('multi-attachment stanzas', () => {
  it('parses the attachments attribute into typed entries', async () => {
    const message = await toMessage(multiStanza(3));
    expect(Array.isArray(message.attachments)).toBe(true);
    const attachments = getMessageAttachments(message);
    expect(attachments).toHaveLength(3);
    expect(attachments.map((a) => a.originalName)).toEqual([
      'shot-0.jpg',
      'shot-1.jpg',
      'shot-2.jpg',
    ]);
    expect(attachments[2]).toMatchObject({
      attachmentId: 'att-2',
      locationPreview: `${FILES}/file-2-s.jpg`,
      mimetype: 'image/jpeg',
    });
  });

  it('keeps the flat fields as attachment #0 for old clients', async () => {
    const message = await toMessage(multiStanza(3));
    expect(message.location).toBe(`${FILES}/file-0.jpg`);
    expect(message.body).toBe('media');
    expect(message.isMediafile).toBe('true');
  });

  it('gives a single-file message exactly one attachment from the flat fields', async () => {
    const message = await toMessage(multiStanza(1));
    expect(message.attachments).toBeUndefined();
    expect(getMessageAttachments(message)).toHaveLength(1);
  });

  it('parses the same through the positional (MAM catch-up) convention', async () => {
    const message = await toPositionalMessage(multiStanza(4));
    expect(getMessageAttachments(message)).toHaveLength(4);
    expect(Array.isArray(message.attachments)).toBe(true);
  });

  it('caps a stanza that lists more than the limit', async () => {
    const message = await toMessage(multiStanza(14));
    expect(message.attachments).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(getMessageAttachments(message)).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
  });

  it('falls back to the flat fields when the attachments attribute is junk', async () => {
    const message = await toMessage(multiStanza(1, { attachments: '{not json' }));
    expect(message.attachments).toBeUndefined();
    expect(getMessageAttachments(message)).toHaveLength(1);
  });
});

describe('legacy media stanzas', () => {
  it('splits a comma separated URL list into attachments', async () => {
    const message = await toMessage(COMMA_LIST_STANZA);
    const attachments = getMessageAttachments(message);
    expect(attachments.map((a) => a.originalName)).toEqual(['a.jpg', 'b.png']);
    expect(attachments.map((a) => a.mimetype)).toEqual(['image/jpeg', 'image/png']);
    expect(attachments[1]!.locationPreview).toMatch(/b-s\.png$/);
    expect(getMessageCaption(message)).toBe('two shots');
  });

  it('reads the typed text of an older client from its body', async () => {
    const message = await toMessage(N1_STANZA);
    expect(isMediaMessage(message)).toBe(true);
    expect(getMessageCaption(message)).toBe('hello');
    expect(getMessageAttachments(message)).toHaveLength(1);
  });

  it('shows no caption for the SDK placeholder body', async () => {
    const message = await toMessage(PLAIN_MEDIA_STANZA);
    expect(getMessageCaption(message)).toBeUndefined();
  });
});

describe('caption in an open room', () => {
  const mentions = JSON.stringify([{ jid: 'bob@x', name: 'Bob', offset: 3, length: 4 }]);

  it('lifts caption and its mention spans onto the message', async () => {
    const message = await toMessage(
      multiStanza(2, { caption: 'hi @Bob look', captionMentions: mentions })
    );
    expect(message.caption).toBe('hi @Bob look');
    expect(message.captionMentions).toEqual([
      { jid: 'bob@x', name: 'Bob', offset: 3, length: 4 },
    ]);
    expect(getMessageCaption(message)).toBe('hi @Bob look');
  });

  it('drops mention spans that do not read @Name any more', async () => {
    const message = await toMessage(
      multiStanza(2, { caption: 'hello there', captionMentions: mentions })
    );
    expect(message.caption).toBe('hello there');
    expect(message.captionMentions).toBeUndefined();
  });

  it('drops a blank caption', async () => {
    const message = await toMessage(multiStanza(2, { caption: '   ' }));
    expect(message.caption).toBeUndefined();
    expect(message.captionMentions).toBeUndefined();
  });

  it('drops orphan mention spans', () => {
    expect(normalizeMediaDataAttrs({ captionMentions: mentions })).toEqual({});
  });
});

describe('caption in an e2ee room', () => {
  const sealedBody = (caption?: string, mentions?: unknown) =>
    JSON.stringify({
      v: 1,
      keys: ['k0', 'k1'],
      ...(caption ? { caption } : {}),
      ...(mentions ? { captionMentions: mentions } : {}),
    });
  const sealedStanza = (body: string, extra: Record<string, string> = {}) =>
    multiStanza(2, { clientEncrypted: 'true', omemoEncrypted: 'true', ...extra }, body);

  it('lifts the caption out of the sealed body next to the keys', async () => {
    const message = await toMessage(sealedStanza(sealedBody('secret caption')));
    expect(message.e2eeKeys).toEqual(['k0', 'k1']);
    expect(message.caption).toBe('secret caption');
    expect(message.body).toBe('media');
  });

  it('keeps valid caption mention spans from the sealed body', async () => {
    const spans = [{ jid: 'bob@x', name: 'Bob', offset: 0, length: 4 }];
    const message = await toMessage(sealedStanza(sealedBody('@Bob hi', spans)));
    expect(message.captionMentions).toEqual(spans);
  });

  it('ignores the open caption attribute of a sealed message', async () => {
    const message = await toMessage(
      sealedStanza(sealedBody(), { caption: 'leaked in the clear' })
    );
    expect(message.e2eeKeys).toEqual(['k0', 'k1']);
    expect(message.caption).toBeUndefined();
    expect(getMessageCaption(message)).toBeUndefined();
  });

  it('prefers the sealed caption over a different open one', async () => {
    const message = await toMessage(
      sealedStanza(sealedBody('inside'), { caption: 'outside' })
    );
    expect(message.caption).toBe('inside');
  });

  it('drops the open caption even when the body is not a readable envelope', async () => {
    const message = await toMessage(
      sealedStanza('Could not be decrypted', { caption: 'outside' })
    );
    expect(message.e2eeKeys).toBeUndefined();
    expect(message.caption).toBeUndefined();
  });

  it('does the same through the positional convention', async () => {
    const message = await toPositionalMessage(
      sealedStanza(sealedBody('inside'), { caption: 'outside' })
    );
    expect(message.caption).toBe('inside');
    expect(message.e2eeKeys).toEqual(['k0', 'k1']);
  });
});

describe('parseSealedMediaPayload', () => {
  it('returns keys alone for a body without a caption', () => {
    expect(parseSealedMediaPayload('{"v":1,"keys":["a"]}')).toEqual({ keys: ['a'] });
  });

  it('rejects anything that is not the envelope', () => {
    expect(parseSealedMediaPayload('media')).toBeUndefined();
    expect(parseSealedMediaPayload('{"v":2,"keys":["a"]}')).toBeUndefined();
    expect(parseSealedMediaPayload('{"v":1,"keys":[]}')).toBeUndefined();
  });
});

describe('a text message is untouched', () => {
  it('has no attachments or caption', async () => {
    const message = await toMessage(stanza('send-text-message:t1', 'hello', {}));
    expect(message.attachments).toBeUndefined();
    expect(message.caption).toBeUndefined();
    expect(isMediaMessage(message)).toBe(false);
  });
});
