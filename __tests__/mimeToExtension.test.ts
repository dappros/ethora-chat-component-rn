import {
  getExtensionForMime,
  filenameFromUrl,
  ensureFilenameHasExtension,
  deriveDisplayFilename,
  getIosAudioPlaybackCacheExtension,
  isUnsupportedAudioForIosPlayback,
  shouldCacheAudioForIosPlayback,
} from '../src/helpers/mimeToExtension';

describe('getExtensionForMime', () => {
  it('returns known extensions for image/video/audio/document MIMEs', () => {
    expect(getExtensionForMime('image/jpeg')).toBe('.jpg');
    expect(getExtensionForMime('image/png')).toBe('.png');
    expect(getExtensionForMime('video/mp4')).toBe('.mp4');
    expect(getExtensionForMime('video/quicktime')).toBe('.mov');
    expect(getExtensionForMime('audio/mp4')).toBe('.m4a');
    expect(getExtensionForMime('audio/mpeg')).toBe('.mp3');
    expect(getExtensionForMime('application/pdf')).toBe('.pdf');
    expect(
      getExtensionForMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('.docx');
  });

  it('strips charset parameters and is case-insensitive', () => {
    expect(getExtensionForMime('text/PLAIN; charset=UTF-8')).toBe('.txt');
    expect(getExtensionForMime('IMAGE/JPEG')).toBe('.jpg');
  });

  it('falls back to .bin for unknown or missing MIME', () => {
    expect(getExtensionForMime('application/foobar')).toBe('.bin');
    expect(getExtensionForMime(undefined)).toBe('.bin');
    expect(getExtensionForMime('')).toBe('.bin');
  });
});

describe('filenameFromUrl', () => {
  it('returns the last path segment', () => {
    expect(filenameFromUrl('https://cdn.example.com/foo/bar/baz.pdf')).toBe(
      'baz.pdf'
    );
  });

  it('strips query strings and fragments', () => {
    expect(
      filenameFromUrl('https://cdn.example.com/foo.mp4?token=abc&x=1')
    ).toBe('foo.mp4');
    expect(filenameFromUrl('https://cdn.example.com/foo.mp4#frag')).toBe(
      'foo.mp4'
    );
  });

  it('URL-decodes the segment', () => {
    expect(
      filenameFromUrl('https://cdn.example.com/My%20File%20(1).pdf')
    ).toBe('My File (1).pdf');
  });

  it('handles missing input gracefully', () => {
    expect(filenameFromUrl(undefined)).toBe('');
    expect(filenameFromUrl('')).toBe('');
  });
});

describe('ensureFilenameHasExtension', () => {
  it('returns input unchanged when an extension is already present', () => {
    expect(ensureFilenameHasExtension('report.pdf', 'application/pdf')).toBe(
      'report.pdf'
    );
  });

  it('appends MIME-derived extension when missing', () => {
    expect(ensureFilenameHasExtension('report', 'application/pdf')).toBe(
      'report.pdf'
    );
    expect(ensureFilenameHasExtension('voicenote', 'audio/mp4')).toBe(
      'voicenote.m4a'
    );
  });

  it('falls back to .bin when MIME is unknown', () => {
    expect(ensureFilenameHasExtension('mystery', 'application/foobar')).toBe(
      'mystery.bin'
    );
  });

  it('generates a base name when input is empty/whitespace', () => {
    const out = ensureFilenameHasExtension('  ', 'image/png');
    expect(out).toMatch(/^media_\d+\.png$/);
  });

  it('does not double-append when input ends in a long token without a dot', () => {
    // No extension on long token → still gets one appended.
    expect(
      ensureFilenameHasExtension('a-very-long-name-without-dot', 'video/mp4')
    ).toBe('a-very-long-name-without-dot.mp4');
  });
});

describe('deriveDisplayFilename', () => {
  it('prefers fileName over originalName over URL', () => {
    expect(
      deriveDisplayFilename({
        fileName: 'preferred.pdf',
        originalName: 'orig.pdf',
        url: 'https://cdn.example.com/url-name.pdf',
        mime: 'application/pdf',
      })
    ).toBe('preferred.pdf');
  });

  it('falls back to originalName when fileName empty', () => {
    expect(
      deriveDisplayFilename({
        fileName: '',
        originalName: 'orig.docx',
        url: undefined,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe('orig.docx');
  });

  it('parses URL when both names missing', () => {
    expect(
      deriveDisplayFilename({
        url: 'https://cdn.example.com/files/Some%20Doc.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe('Some Doc.docx');
  });

  it('produces a media_<ts> fallback when nothing is usable', () => {
    const out = deriveDisplayFilename({ mime: 'video/mp4' });
    expect(out).toMatch(/^media_\d+\.mp4$/);
  });

  it('appends extension when URL segment has no extension', () => {
    expect(
      deriveDisplayFilename({
        url: 'https://cdn.example.com/abc123',
        mime: 'audio/wav',
      })
    ).toBe('abc123.wav');
  });
});

describe('iOS audio playback fallback', () => {
  it('caches remote octet-stream voice files so AVFoundation gets an audio extension', () => {
    expect(
      shouldCacheAudioForIosPlayback({
        src: 'https://cdn.example.com/files/opaque.bin',
        mime: 'application/octet-stream',
        fileName: 'opaque.bin',
        originalName: 'voice-note.bin',
      })
    ).toBe(true);
  });

  it('does not cache local files or remote audio that already has a playable audio name', () => {
    expect(
      shouldCacheAudioForIosPlayback({
        src: 'file:///tmp/voice.m4a',
        mime: 'audio/m4a',
        fileName: 'voice.m4a',
      })
    ).toBe(false);
    expect(
      shouldCacheAudioForIosPlayback({
        src: 'https://cdn.example.com/voice.m4a',
        mime: 'audio/m4a',
        fileName: 'voice.m4a',
      })
    ).toBe(false);
  });

  it('chooses an iOS-playable cache extension and falls back to m4a', () => {
    expect(
      getIosAudioPlaybackCacheExtension({
        mime: 'application/octet-stream',
        fileName: 'voice.bin',
        originalName: 'recording',
        url: 'https://cdn.example.com/files/abc123',
      })
    ).toBe('.m4a');
    expect(
      getIosAudioPlaybackCacheExtension({
        mime: 'audio/wav',
        fileName: 'voice',
        url: 'https://cdn.example.com/files/abc123',
      })
    ).toBe('.wav');
  });

  it('flags webm/ogg-style audio as unsupported for native iOS playback', () => {
    expect(
      isUnsupportedAudioForIosPlayback({
        mime: 'audio/webm',
        fileName: 'voice.webm',
      })
    ).toBe(true);
    expect(
      isUnsupportedAudioForIosPlayback({
        mime: 'application/octet-stream',
        originalName: 'voice-note.weba',
      })
    ).toBe(true);
    expect(
      isUnsupportedAudioForIosPlayback({
        mime: 'audio/mp4',
        fileName: 'voice.m4a',
      })
    ).toBe(false);
  });
});
