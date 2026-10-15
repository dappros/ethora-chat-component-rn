import {
  getMessageCaption,
  getMessageCaptionMentions,
  normalizeCaptionInput,
  normalizeCaptionMentions,
} from '../src/helpers/caption';
import { createMainMessageForThread } from '../src/helpers/createMainMessageForThread';

describe('normalizeCaptionInput', () => {
  it('returns nothing for blank text, so no caption is sent', () => {
    expect(normalizeCaptionInput({ text: '   \n ' })).toBeUndefined();
    expect(normalizeCaptionInput(undefined)).toBeUndefined();
  });

  it('keeps valid mention spans and drops stale ones', () => {
    const result = normalizeCaptionInput({
      text: 'hey @Alice',
      mentions: [
        { jid: 'a@x', name: 'Alice', offset: 4, length: 6 },
        { jid: 'b@x', name: 'Bob', offset: 0, length: 4 },
      ],
    });
    expect(result?.caption).toBe('hey @Alice');
    expect(result?.mentions).toEqual([{ jid: 'a@x', name: 'Alice', offset: 4, length: 6 }]);
  });

  it('omits the mentions key when no span survives', () => {
    expect(normalizeCaptionInput({ text: 'plain' })).toEqual({ caption: 'plain' });
  });
});

describe('normalizeCaptionMentions', () => {
  it('accepts a JSON string, as it arrives on the wire', () => {
    const json = JSON.stringify([{ jid: 'a@x', name: 'Alice', offset: 0, length: 6 }]);
    expect(normalizeCaptionMentions(json, '@Alice hi')).toEqual([
      { jid: 'a@x', name: 'Alice', offset: 0, length: 6 },
    ]);
  });

  it('ignores junk rather than throwing', () => {
    expect(normalizeCaptionMentions('not json', 'x')).toBeUndefined();
    expect(normalizeCaptionMentions([{ jid: 1 }], 'x')).toBeUndefined();
  });
});

describe('getMessageCaption', () => {
  it('returns the caption, or undefined for none or blank', () => {
    expect(getMessageCaption({ caption: 'hi' })).toBe('hi');
    expect(getMessageCaption({ caption: '  ' })).toBeUndefined();
    expect(getMessageCaption({})).toBeUndefined();
    expect(getMessageCaption(null)).toBeUndefined();
  });

  it('treats the media placeholder body as no caption', () => {
    const message = { isMediafile: 'true', location: 'https://f/a.png', body: 'media' };
    expect(getMessageCaption(message)).toBeUndefined();
  });

  it('reads real text from the body of an older media message', () => {
    const message = { isMediafile: 'true', location: 'https://f/a.png', body: 'hello' };
    expect(getMessageCaption(message)).toBe('hello');
  });

  it('does not take the file name for a caption', () => {
    const message = {
      isMediafile: 'true',
      location: 'https://f/a.png',
      originalName: 'a.png',
      body: 'a.png',
    };
    expect(getMessageCaption(message)).toBeUndefined();
  });

  it('never derives a caption from the body of a sealed message', () => {
    const message = {
      isMediafile: 'true',
      clientEncrypted: 'true',
      location: 'https://f/a',
      body: 'hello',
    };
    expect(getMessageCaption(message)).toBeUndefined();
  });

  it('reads aliases other clients stamp on <data>', () => {
    const message = { isMediafile: 'true', location: 'https://f/a.png', description: 'from alias' };
    expect(getMessageCaption(message)).toBe('from alias');
  });

  it('exposes caption mention spans', () => {
    const spans = [{ jid: 'a@x', name: 'Alice', offset: 0, length: 6 }];
    expect(
      getMessageCaptionMentions({ caption: '@Alice hi', captionMentions: spans })
    ).toEqual(spans);
  });
});

describe('createMainMessageForThread for a media message', () => {
  const base = {
    id: 'm1',
    body: 'media',
    date: '2026-01-01T00:00:00.000Z',
    roomJid: 'room@conference.x',
    user: { name: 'Ada' },
    location: 'https://files.example.com/a.png',
    mimetype: 'image/png',
  } as never;

  it('quotes the caption when there is one', () => {
    const data = JSON.parse(createMainMessageForThread({ ...(base as object), caption: 'look' } as never));
    expect(data.text).toBe('look');
  });

  it('keeps the old body text when there is no caption', () => {
    expect(JSON.parse(createMainMessageForThread(base)).text).toBe('media');
  });

  it('never quotes a sealed caption into a reply stanza', () => {
    const data = JSON.parse(
      createMainMessageForThread({ ...(base as object), caption: 'secret', clientEncrypted: 'true' } as never)
    );
    expect(data.text).toBe('media');
    expect(JSON.stringify(data)).not.toContain('secret');
  });
});
