/**
 * getDisplayFileName - bug #40 regression coverage.
 *
 * Attachments used to show/save under the server's stored hash name
 * (`fileName`, e.g. "3f9a1c...c2.pdf") instead of the sender's original
 * name (`originalName`, e.g. "test1.pdf"). These tests pin the priority
 * order (originalName > fileName > URL) and the sanitize/dedupe helpers
 * used when actually writing the file to disk.
 */

import {
  getDisplayFileName,
  getUniqueFileName,
  sanitizeFileNameForPath,
} from '../src/helpers/getDisplayFileName';

describe('getDisplayFileName', () => {
  it('prefers originalName over the stored hash fileName', () => {
    expect(
      getDisplayFileName({
        originalName: 'test1.pdf',
        fileName: '3f9a1c2b8e7d4a1f9b0c6d5e4f3a2b1c.pdf',
        mimetype: 'application/pdf',
      })
    ).toBe('test1.pdf');
  });

  it('falls back to fileName when originalName is missing', () => {
    expect(
      getDisplayFileName({
        fileName: '3f9a1c2b.pdf',
        mimetype: 'application/pdf',
      })
    ).toBe('3f9a1c2b.pdf');
  });

  it('falls back to fileName when originalName is an empty string', () => {
    expect(
      getDisplayFileName({
        originalName: '',
        fileName: 'report.docx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe('report.docx');
  });

  it('falls back to fileName when originalName is only whitespace', () => {
    expect(
      getDisplayFileName({
        originalName: '   ',
        fileName: 'report.docx',
      })
    ).toBe('report.docx');
  });

  it('falls back to the last path segment of location when neither name is present', () => {
    expect(
      getDisplayFileName({
        location: 'https://cdn.example.com/uploads/photo.jpg?ft=abc123',
      })
    ).toBe('photo.jpg');
  });

  it('appends an extension derived from mimetype when the hash name has none', () => {
    expect(
      getDisplayFileName({
        fileName: '3f9a1c2b8e7d4a1f',
        mimetype: 'application/pdf',
      })
    ).toBe('3f9a1c2b8e7d4a1f.pdf');
  });

  it('appends an extension derived from mimetype onto originalName too', () => {
    expect(
      getDisplayFileName({
        originalName: 'test1',
        mimetype: 'application/pdf',
      })
    ).toBe('test1.pdf');
  });

  it('falls back to .bin when nothing has an extension and the mime is unknown', () => {
    expect(
      getDisplayFileName({
        fileName: '3f9a1c2b8e7d4a1f',
      })
    ).toBe('3f9a1c2b8e7d4a1f.bin');
  });

  it('returns a generic timestamped name when there is nothing usable at all', () => {
    const result = getDisplayFileName({});
    expect(result).toMatch(/^media_\d+\.bin$/);
  });
});

describe('sanitizeFileNameForPath', () => {
  it('replaces path separators so the name cannot escape the target directory', () => {
    expect(sanitizeFileNameForPath('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('replaces backslashes too', () => {
    expect(sanitizeFileNameForPath('a\\b\\c.txt')).toBe('a_b_c.txt');
  });

  it('strips control characters', () => {
    expect(sanitizeFileNameForPath('bad\x00name.txt')).toBe('badname.txt');
  });

  it('falls back to "file" for an empty/whitespace-only name', () => {
    expect(sanitizeFileNameForPath('   ')).toBe('file');
  });

  it('leaves an ordinary name untouched', () => {
    expect(sanitizeFileNameForPath('test1.pdf')).toBe('test1.pdf');
  });
});

describe('getUniqueFileName', () => {
  it('returns the sanitized name unchanged when there is no collision', async () => {
    const exists = jest.fn().mockResolvedValue(false);
    await expect(getUniqueFileName('test1.pdf', exists)).resolves.toBe(
      'test1.pdf'
    );
    expect(exists).toHaveBeenCalledWith('test1.pdf');
  });

  it('suffixes " (1)" on the first collision', async () => {
    const existing = new Set(['test1.pdf']);
    const exists = async (candidate: string) => existing.has(candidate);
    await expect(getUniqueFileName('test1.pdf', exists)).resolves.toBe(
      'test1 (1).pdf'
    );
  });

  it('keeps incrementing past multiple collisions', async () => {
    const existing = new Set([
      'test1.pdf',
      'test1 (1).pdf',
      'test1 (2).pdf',
    ]);
    const exists = async (candidate: string) => existing.has(candidate);
    await expect(getUniqueFileName('test1.pdf', exists)).resolves.toBe(
      'test1 (3).pdf'
    );
  });

  it('handles a collision on a name with no extension', async () => {
    const existing = new Set(['report']);
    const exists = async (candidate: string) => existing.has(candidate);
    await expect(getUniqueFileName('report', exists)).resolves.toBe(
      'report (1)'
    );
  });
});
